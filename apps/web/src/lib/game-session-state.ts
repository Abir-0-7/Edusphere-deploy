import {
  applyGame,
  getGameResult,
  getPublicQuestion,
  restoreGame,
  serializeGame,
} from '@studyvault/game-engine';
import {
  GamePublicViewSchema,
  GameSessionSchema,
  GameSnapshotSchema,
  type GameCommandInput,
  type GameSession,
} from '@studyvault/types';
import type { gameSessions } from '@studyvault/db';

export function sessionResponse(row: typeof gameSessions.$inferSelect): GameSession {
  const snapshot = GameSnapshotSchema.parse(row.snapshot);
  const state = restoreGame(snapshot);
  const result = getGameResult(state);
  const question = getPublicQuestion(state);
  return GameSessionSchema.parse({
    id: row.id,
    revision: row.revision,
    snapshot,
    view: GamePublicViewSchema.parse({
      values: state.values,
      columns: state.columns,
      towers: state.towers,
      question,
      feedback: state.feedback,
      correct: state.correct,
      mistakes: state.mistakes,
      hints: state.hints,
      score: result.score,
      explanation: result.explanation,
    }),
    status: row.status,
    tokens_awarded: row.tokensAwarded,
    updated_at: new Date(row.updatedAt).toISOString(),
  });
}

/** Pure state transition; persistence and rewards are committed together by the route. */
export function transitionSession(row: typeof gameSessions.$inferSelect, input: GameCommandInput) {
  let status = row.status;
  let snapshot = GameSnapshotSchema.parse(row.snapshot);
  let reward = 0;
  if (['won', 'lost', 'abandoned'].includes(status)) throw new Error('game session has ended');
  switch (input.command) {
    case 'start':
      if (status !== 'ready') throw new Error('only a ready session can start');
      status = 'playing';
      break;
    case 'pause':
      if (status !== 'playing') throw new Error('only a playing session can pause');
      status = 'paused';
      break;
    case 'resume':
      if (status !== 'paused') throw new Error('only a paused session can resume');
      status = 'playing';
      break;
    case 'abandon':
      status = 'abandoned';
      break;
    case 'act': {
      if (status !== 'playing') throw new Error('start or resume the session before playing');
      const next = applyGame(restoreGame(snapshot), input.action);
      snapshot = serializeGame(next);
      const result = getGameResult(next);
      if (result.status !== 'playing') status = result.status;
      if (result.rewardEligible) reward = Math.min(5, Math.max(1, Math.floor(result.score / 200)));
      break;
    }
  }
  return { snapshot, status, reward };
}

/** Bounded UTF-8 body read, including chunked requests without Content-Length. */
export async function gameRequestBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > 4096) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}
