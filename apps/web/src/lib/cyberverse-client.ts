import {
  CYBERVERSE_GAME_ID,
  CyberverseProgressInputSchema,
  CyberverseResponseSchema,
  CyberverseUnlockInputSchema,
  ErrorEnvelopeSchema,
} from '@studyvault/types';
import { z } from 'zod';

const channel = 'edusphere.game-vault';
const envelope = z.object({
  channel: z.literal(channel),
  version: z.literal(1),
  gameId: z.literal(CYBERVERSE_GAME_ID),
  requestId: z.string().max(128),
});
const incoming = z.discriminatedUnion('type', [
  envelope.extend({ type: z.literal('EDUSPHERE_GAME_READY'), payload: z.object({}) }),
  envelope.extend({
    type: z.literal('EDUSPHERE_UNLOCK_MISSION_REQUEST'),
    payload: CyberverseUnlockInputSchema.pick({ missionId: true }),
  }),
  // The shipped game includes display-only XP and achievements. Zod strips them.
  envelope.extend({
    type: z.literal('EDUSPHERE_MISSION_PROGRESS'),
    payload: CyberverseProgressInputSchema.pick({ missionId: true, evidence: true })
      .strip()
      .extend({ completed: z.literal(true) }),
  }),
]);

export function readCyberverseMessage(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  frame: Window,
  origin: string,
) {
  if (event.source !== frame || event.origin !== origin) return null;
  try {
    if (JSON.stringify(event.data).length > 65_536) return null;
  } catch {
    return null;
  }
  const result = incoming.safeParse(event.data);
  if (!result.success || (result.data.type !== 'EDUSPHERE_GAME_READY' && !result.data.requestId)) return null;
  return result.data;
}

export function cyberverseHostMessage(type: string, requestId: string, payload: object) {
  return { channel, version: 1, gameId: CYBERVERSE_GAME_ID, type, requestId, payload };
}

export class CyberverseApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function cyberverseRequest(operation: 'context' | 'unlock' | 'progress', body?: object) {
  const response = await fetch(
    `/api/game-vault/${operation}${operation === 'context' ? '?gameId=cyberverse' : ''}`,
    {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = ErrorEnvelopeSchema.safeParse(data);
    throw error.success
      ? new CyberverseApiError(error.data.error.code, error.data.error.message)
      : new CyberverseApiError('service_unavailable', 'Cyberverse could not connect. Try again.');
  }
  return CyberverseResponseSchema.parse(data).state;
}
