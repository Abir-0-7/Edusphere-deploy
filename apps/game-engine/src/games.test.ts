import { describe, expect, it } from 'vitest';
import { FixedTimestepLoop } from './loop';
import { SortingRace } from './games/sorting-race';
import { NQueens } from './games/n-queens';
import { TowersOfHanoi } from './games/hanoi';
import { FlashcardTowerDefense } from './games/tower-defense';
import { isTowerAnswerCorrect, validateCompletion } from './completion';

describe('fixed timestep', () => { it('runs deterministic steps and caps a frame', () => { const loop = new FixedTimestepLoop(10); let n = 0; expect(loop.advance(0.25, () => n++)).toBe(2); expect(n).toBe(2); }); });
describe('minigames', () => {
  it('sorts and scores', () => { const game = new SortingRace([2, 1]); game.swap(0, 1); expect(game.complete).toBe(true); expect(game.score).toBeGreaterThan(0); });
  it('validates queens', () => { const game = new NQueens(4); [1, 3, 0, 2].forEach((column, row) => game.place(row, column)); expect(game.complete).toBe(true); });
  it('rejects illegal hanoi moves', () => { const game = new TowersOfHanoi(2); expect(game.move(0, 2)).toBe(true); expect(game.move(0, 2)).toBe(false); });
  it('answers tower enemies', () => { const game = new FlashcardTowerDefense(); game.spawn(0); expect(game.answer(1, true)).toBe(true); expect(game.score).toBe(100); });
  it('accepts a false choice for a false card while rejecting a true choice', () => {
    const game = new FlashcardTowerDefense();
    game.spawn(0);
    game.spawn(1);
    expect(game.answer(2, isTowerAnswerCorrect(2, true))).toBe(false);
    expect(game.score).toBe(0);
    expect(game.answer(2, isTowerAnswerCorrect(2, false))).toBe(true);
    expect(game.score).toBe(100);
    expect(game.enemies.map((enemy) => enemy.id)).toEqual([1]);
  });
});

describe('server replayed game completions', () => {
  it('accepts only completed replayable actions', () => {
    expect(validateCompletion('SortingRace', [{ type: 'swap', left: 0, right: 1 }, { type: 'swap', left: 1, right: 3 }]).complete).toBe(true);
    expect(validateCompletion('NQueens', [1, 3, 0, 2].map((column, row) => ({ type: 'place', row, column }))).complete).toBe(true);
    const moves: Array<{ type: 'move'; from: number; to: number }> = [];
    const solve = (count: number, from: number, to: number, spare: number): void => {
      if (count === 0) return;
      solve(count - 1, from, spare, to);
      moves.push({ type: 'move', from, to });
      solve(count - 1, spare, to, from);
    };
    solve(4, 0, 2, 1);
    expect(validateCompletion('TowersOfHanoi', moves).complete).toBe(true);
    expect(validateCompletion('SortingRace', []).complete).toBe(false);
    expect(validateCompletion('NQueens', [{ type: 'place', row: 0, column: 0 }]).complete).toBe(false);
  });

  it('verifies tower-defense answers from the server card deck', () => {
    const actions = Array.from({ length: 5 }, (_, index) => [
      { type: 'spawn' as const, lane: index % 3, hp: 1 },
      { type: 'answer' as const, enemyId: index + 1, answer: [true, false, true, false][index % 4]! },
    ]).flat();
    expect(validateCompletion('FlashcardTowerDefense', actions).complete).toBe(true);
    const fake = actions.map((action) => action.type === 'answer' ? { ...action, answer: !action.answer } : action);
    expect(validateCompletion('FlashcardTowerDefense', fake).complete).toBe(false);
  });
});
