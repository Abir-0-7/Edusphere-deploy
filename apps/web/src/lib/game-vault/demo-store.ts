import { getVaultGame } from './catalog';
import { isRecord, readVaultState, type VaultState } from './protocol';

export type DemoStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type DemoResult = { ok: true; state: VaultState } | { ok: false; error: string };
const INITIAL_TOKENS = 100;
const BINARY_ANSWERS = [1, 2, 0, 3, 2, 0];

export function demoStorageKey(studentId: string, gameId: string): string {
  return `edusphere.game-vault.demo.v1:${encodeURIComponent(studentId)}:${encodeURIComponent(gameId)}`;
}

export function freshDemo(student: VaultState['student']): VaultState {
  return {
    mode: 'demo',
    student: { ...student },
    tokens: INITIAL_TOKENS,
    xp: 0,
    unlocked: [],
    completed: [],
    achievements: [],
  };
}

/** Demo state never receives a production balance, unlock list or reward list. */
export function loadDemo(
  storage: DemoStorage | null,
  student: VaultState['student'],
  gameId: string,
): VaultState {
  const fresh = freshDemo(student);
  const game = getVaultGame(gameId);
  if (!storage || !game) return fresh;
  try {
    const raw = storage.getItem(demoStorageKey(student.id, gameId));
    if (!raw) return fresh;
    const saved: unknown = JSON.parse(raw);
    const value = readVaultState(saved, game);
    if (!value || value.mode !== 'demo' || value.student.id !== student.id) return fresh;
    // Synthetic balance/rewards can be reconstructed from known local entitlements.
    const cost = game.missions
      .filter((mission) => value.unlocked.includes(mission.id))
      .reduce((total, mission) => total + mission.tokens, 0);
    if (cost > INITIAL_TOKENS || value.completed.some((id) => id !== 'binary_city')) return fresh;
    return {
      ...value,
      student: { ...student },
      tokens: INITIAL_TOKENS - cost,
      xp: value.completed.includes('binary_city') ? 100 : 0,
      achievements: value.completed.includes('binary_city') ? ['first_transmission'] : [],
    };
  } catch {
    return fresh;
  }
}

export function saveDemo(storage: DemoStorage | null, gameId: string, state: VaultState): boolean {
  if (!storage || state.mode !== 'demo') return false;
  try {
    storage.setItem(demoStorageKey(state.student.id, gameId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function unlockDemo(state: VaultState, gameId: string, missionId: string): DemoResult {
  if (state.mode !== 'demo') return { ok: false, error: 'demo_state_required' };
  const mission = getVaultGame(gameId)?.missions.find((item) => item.id === missionId);
  if (!mission) return { ok: false, error: 'mission_not_found' };
  if (state.unlocked.includes(missionId)) return { ok: true, state };
  if (state.tokens < mission.tokens) return { ok: false, error: 'insufficient_tokens' };
  return {
    ok: true,
    state: { ...state, tokens: state.tokens - mission.tokens, unlocked: [...state.unlocked, missionId] },
  };
}

export function completeDemo(
  state: VaultState,
  gameId: string,
  missionId: string,
  evidence: unknown,
): DemoResult {
  if (state.mode !== 'demo') return { ok: false, error: 'demo_state_required' };
  if (gameId !== 'cyberverse' || missionId !== 'binary_city')
    return { ok: false, error: 'mission_not_playable' };
  if (!state.unlocked.includes(missionId)) return { ok: false, error: 'mission_locked' };
  if (state.completed.includes(missionId)) return { ok: true, state };
  if (
    !isRecord(evidence) ||
    evidence.challengeVersion !== 'binary-v1' ||
    !Array.isArray(evidence.answers) ||
    evidence.answers.length !== BINARY_ANSWERS.length ||
    !evidence.answers.every((answer, index) => answer === BINARY_ANSWERS[index])
  ) {
    return { ok: false, error: 'completion_rejected' };
  }
  return {
    ok: true,
    state: {
      ...state,
      xp: state.xp + 100,
      completed: [...state.completed, missionId],
      achievements: [...new Set([...state.achievements, 'first_transmission'])],
    },
  };
}
