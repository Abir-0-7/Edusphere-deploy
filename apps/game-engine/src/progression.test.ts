import { describe, expect, it } from 'vitest';
import {
  applyGame,
  createGame,
  getGameResult,
  getPublicQuestion,
  restoreGame,
  serializeGame,
  type GameAction,
  type GameConfig,
  type GameState,
} from './session';
import { questionsFor } from './content';

function action(state: GameState, value: GameAction) {
  return applyGame(state, { seq: state.actions.length + 1, action: value });
}
const config = (
  game_id: GameConfig['game_id'],
  difficulty: GameConfig['difficulty'],
  practice = false,
): GameConfig => ({ version: 1, seed: 23, game_id, difficulty, practice });

for (const difficulty of ['easy', 'medium', 'hard'] as const)
  describe(`${difficulty} progression vectors`, () => {
    it('solves seeded duplicate/negative sorting and restores the exact result', () => {
      let state = createGame(config('SortingRace', difficulty));
      const bag = [...state.values].sort((a, b) => a - b);
      for (let i = 0; i < bag.length && getGameResult(state).status === 'playing'; i++) {
        const j = state.values.indexOf(bag[i]!, i);
        if (i !== j) state = action(state, { type: 'swap', left: i, right: j });
      }
      expect(state.values).toEqual(bag);
      expect(getGameResult(restoreGame(serializeGame(state)))).toEqual(getGameResult(state));
      expect(getGameResult(state).status).toBe('won');
    });
    it('conserves disks, rejects illegal moves and solves Hanoi in 2^n-1 moves', () => {
      let state = createGame(config('TowersOfHanoi', difficulty));
      const n = state.towers[0]!.length;
      expect(() => action(state, { type: 'move', from: 0, to: 0 })).toThrow();
      const solve = (count: number, from: number, to: number, spare: number): void => {
        if (!count) return;
        solve(count - 1, from, spare, to);
        state = action(state, { type: 'move', from, to });
        expect(state.towers.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        solve(count - 1, spare, to, from);
      };
      solve(n, 0, 2, 1);
      expect(state.moves).toBe(2 ** n - 1);
      expect(getGameResult(state).status).toBe('won');
    });
    it('accepts a complete non-attacking queens solution and rejects incomplete/conflicting boards', () => {
      let state = createGame(config('NQueens', difficulty));
      const n = state.columns.length;
      state = action(state, { type: 'place', row: 0, column: 0 });
      state = action(state, { type: 'place', row: 1, column: 0 });
      expect(getGameResult(state).status).toBe('playing');
      const solution: number[] = [];
      const solve = (row: number): boolean => {
        if (row === n) return true;
        for (let col = 0; col < n; col++)
          if (solution.every((c, r) => c !== col && Math.abs(c - col) !== row - r)) {
            solution.push(col);
            if (solve(row + 1)) return true;
            solution.pop();
          }
        return false;
      };
      expect(solve(0)).toBe(true);
      for (const [row, column] of solution.entries()) state = action(state, { type: 'place', row, column });
      expect(getGameResult(state).status).toBe('won');
    });
    for (const id of ['ConceptMatch', 'RetrievalSprint', 'CodeTrace', 'FlashcardTowerDefense'] as const) {
      it(`checks ${id} correct/incorrect keys and preserves untimed reading state`, () => {
        let state = createGame(config(id, difficulty));
        const saved = serializeGame(state);
        expect(serializeGame(restoreGame(saved))).toEqual(saved);
        for (const q of questionsFor(state.config)) {
          expect(getPublicQuestion(state)).not.toHaveProperty('answer');
          state = action(state, { type: 'answer', question_id: q.id, choice: q.answer });
          expect(state.feedback).toMatchObject({ question_id: q.id, correct: true, source: q.source });
        }
        expect(getGameResult(state)).toMatchObject({ status: 'won', rewardEligible: true });
        let lost = createGame(config(id, difficulty));
        for (const q of questionsFor(lost.config).slice(0, 3))
          lost = action(lost, {
            type: 'answer',
            question_id: q.id,
            choice: (q.answer + 1) % q.choices.length,
          });
        expect(getGameResult(lost)).toMatchObject({ status: 'lost', rewardEligible: false });
      });
    }
  });

describe('bounded untrusted restore', () => {
  it('rejects malformed actions, replayed sequence numbers and oversized snapshots', () => {
    const state = createGame(config('NQueens', 'easy'));
    const first = action(state, { type: 'place', row: 0, column: 1 });
    expect(() => applyGame(first, { seq: 1, action: { type: 'hint' } })).toThrow();
    expect(() =>
      restoreGame({
        ...serializeGame(state),
        actions: Array.from({ length: 501 }, (_, i) => ({
          seq: i + 1,
          action: { type: 'place', row: 0, column: 0 },
        })),
      }),
    ).toThrow();
    expect(() => createGame({ ...state.config, seed: Infinity })).toThrow();
    expect(() =>
      restoreGame({
        config: { ...state.config, game_id: 'TowersOfHanoi', practice: true },
        actions: [
          { seq: 1, action: { type: 'move', from: 1, to: 2 } },
          { seq: 2, action: { type: 'undo' } },
        ],
      }),
    ).toThrow('empty peg');
  });
});
