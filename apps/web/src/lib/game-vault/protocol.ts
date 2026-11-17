import type { GameVaultEntry } from './catalog';

export const VAULT_CHANNEL = 'edusphere.game-vault';
export const VAULT_VERSION = 1;

export type VaultState = {
  mode: 'production' | 'demo';
  student: { id: string; displayName: string };
  tokens: number;
  xp: number;
  unlocked: string[];
  completed: string[];
  achievements: string[];
};

export type GameMessageType =
  'EDUSPHERE_GAME_READY' | 'EDUSPHERE_UNLOCK_MISSION_REQUEST' | 'EDUSPHERE_MISSION_PROGRESS';
export type HostMessageType =
  'EDUSPHERE_INIT_CONTEXT' | 'EDUSPHERE_UNLOCK_MISSION_RESPONSE' | 'EDUSPHERE_MISSION_PROGRESS_RESPONSE';
export type GameMessage = {
  channel: typeof VAULT_CHANNEL;
  version: typeof VAULT_VERSION;
  gameId: string;
  type: GameMessageType;
  requestId: string;
  payload: Record<string, unknown>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Origin and window identity are checked before any game data is considered. */
export function readGameMessage(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  frame: Window | null,
  origin: string,
  game: GameVaultEntry,
): GameMessage | null {
  if (!frame || origin === 'null' || event.source !== frame || event.origin !== origin) return null;
  const value: unknown = event.data;
  if (
    !isRecord(value) ||
    value.channel !== VAULT_CHANNEL ||
    value.version !== VAULT_VERSION ||
    value.gameId !== game.id
  )
    return null;
  if (typeof value.requestId !== 'string' || value.requestId.length > 128 || !isRecord(value.payload))
    return null;
  const allowed: string[] = [
    'EDUSPHERE_GAME_READY',
    'EDUSPHERE_UNLOCK_MISSION_REQUEST',
    'EDUSPHERE_MISSION_PROGRESS',
  ];
  if (typeof value.type !== 'string' || !allowed.includes(value.type)) return null;
  try {
    if (JSON.stringify(value).length > 65536) return null;
  } catch {
    return null;
  }
  if (value.type !== 'EDUSPHERE_GAME_READY') {
    const payload = value.payload;
    const missionId = payload.missionId;
    if (
      !value.requestId ||
      typeof missionId !== 'string' ||
      !game.missions.some((mission) => mission.id === missionId)
    )
      return null;
    if (
      value.type === 'EDUSPHERE_MISSION_PROGRESS' &&
      (payload.completed !== true || !isRecord(payload.evidence))
    )
      return null;
  }
  return value as GameMessage;
}

export function hostMessage(
  gameId: string,
  type: HostMessageType,
  requestId: string,
  payload: Record<string, unknown>,
) {
  return { channel: VAULT_CHANNEL, version: VAULT_VERSION, gameId, type, requestId, payload };
}

export function readVaultState(value: unknown, game: GameVaultEntry): VaultState | null {
  if (!isRecord(value) || (value.mode !== 'production' && value.mode !== 'demo')) return null;
  if (
    !Number.isSafeInteger(value.tokens) ||
    Number(value.tokens) < 0 ||
    !Number.isSafeInteger(value.xp) ||
    Number(value.xp) < 0
  )
    return null;
  if (
    !isRecord(value.student) ||
    typeof value.student.id !== 'string' ||
    typeof value.student.displayName !== 'string'
  )
    return null;
  const ids = new Set(game.missions.map((mission) => mission.id));
  if (!Array.isArray(value.unlocked) || !value.unlocked.every((id) => typeof id === 'string' && ids.has(id)))
    return null;
  if (
    !Array.isArray(value.completed) ||
    !value.completed.every(
      (id) => typeof id === 'string' && value.unlocked instanceof Array && value.unlocked.includes(id),
    )
  )
    return null;
  if (
    !Array.isArray(value.achievements) ||
    !value.achievements.every((id) => typeof id === 'string' && id.length <= 100)
  )
    return null;
  return {
    mode: value.mode,
    student: { id: value.student.id, displayName: value.student.displayName.slice(0, 100) },
    tokens: Number(value.tokens),
    xp: Number(value.xp),
    unlocked: [...new Set(value.unlocked as string[])],
    completed: [...new Set(value.completed as string[])],
    achievements: [...new Set(value.achievements as string[])],
  };
}
