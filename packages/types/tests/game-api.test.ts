import { describe, expect, it } from 'vitest';
import {
  GameConfigSchema,
  GameCommandInputSchema,
  GameCreateInputSchema,
  GameSnapshotSchema,
} from '../src/game-api';

describe('versioned Game Vault boundaries', () => {
  const config = { version: 1, game_id: 'CodeTrace', difficulty: 'easy', seed: 0, practice: false };
  it('validates explicit version, seed bounds and source-free create requests', () => {
    expect(GameConfigSchema.parse(config)).toEqual(config);
    for (const patch of [
      { version: 2 },
      { seed: -1 },
      { seed: 2 ** 32 },
      { practice: 'false' },
      { difficulty: 'impossible' },
      { deck_id: 'foreign' },
    ]) {
      expect(GameConfigSchema.safeParse({ ...config, ...patch }).success).toBe(false);
    }
    expect(GameCreateInputSchema.safeParse({ game_id: 'CodeTrace', seed: 1 }).success).toBe(false);
    expect(
      GameCreateInputSchema.safeParse({ game_id: 'NQueens', objective_id: 'python.branching' }).success,
    ).toBe(false);
    expect(
      GameConfigSchema.safeParse({ ...config, game_id: 'NQueens', objective_id: 'python.branching' }).success,
    ).toBe(false);
  });
  it('rejects oversized logs, unknown actions and client score injection', () => {
    const action = { seq: 1, action: { type: 'answer', question_id: 'trace-add', choice: 1 } };
    expect(GameCommandInputSchema.safeParse({ revision: 0, command: 'act', action }).success).toBe(true);
    for (const mutation of [
      { seq: 0 },
      { action: { type: 'spawn', lane: 0 } },
      { score: 999 },
      { action: { type: 'answer', question_id: 'x', choice: -1 } },
    ]) {
      expect(
        GameCommandInputSchema.safeParse({ revision: 0, command: 'act', action: { ...action, ...mutation } })
          .success,
      ).toBe(false);
    }
    expect(GameSnapshotSchema.safeParse({ config, actions: Array(501).fill(action) }).success).toBe(false);
  });
});
