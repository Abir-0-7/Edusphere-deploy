import { describe, expect, it } from 'vitest';
import { SortingRace } from './games/sorting-race';
import { NQueens } from './games/n-queens';
import { TowersOfHanoi } from './games/hanoi';
import { FlashcardTowerDefense } from './games/tower-defense';
import { validateCompletion, type GameAction } from './completion';
import { GameSession } from './legacy-session';
import { FixedTimestepLoop } from './loop';
import { createServerRewardClient } from './rewards';

describe('existing game rule repairs', () => {
  it('sorts negative duplicate values without losing item identity', () => {
    const game = new SortingRace([3, -2, 0, -2]);
    expect(game.swap(0, 1)).toBe(true);
    expect(game.swap(1, 3)).toBe(true);
    expect(game.complete).toBe(true);
    expect(game.items.map((item) => item.value)).toEqual([-2, -2, 0, 3]);
    expect(new Set(game.items.map((item) => item.id)).size).toBe(4);
    expect(game.swap(0, 1)).toBe(false);
  });
  it('rejects fractional/invalid swaps and malformed initial values', () => {
    const game = new SortingRace([2, 1]);
    expect(game.swap(0.5, 1)).toBe(false);
    expect(game.swap(0, 0)).toBe(false);
    expect(game.swap(-1, 1)).toBe(false);
    expect(() => new SortingRace([1, NaN])).toThrow();
  });
  it('detects queen column/diagonal attacks, permits correction, and reaches the fourth row', () => {
    const session = new GameSession('NQueens');
    session.choose(0);
    session.choose(4);
    const game = session.state as NQueens;
    expect(game.attacked(1, 0)).toBe(true);
    expect(game.attacked(1, 1)).toBe(true);
    expect(game.complete).toBe(false);
    session.choose(4);
    expect(game.columns[1]).toBe(-1);
    session.reset();
    [1, 7, 8, 14].forEach((index) => session.choose(index));
    expect(session.complete).toBe(true);
    expect(validateCompletion('NQueens', session.actions)).toEqual({
      complete: true,
      score: session.state.score,
    });
    expect(game.place(0.5, 1)).toBe(false);
  });
  it('conserves every Hanoi disk through legal and rejected moves', () => {
    const game = new TowersOfHanoi(4);
    expect(game.move(0, 0)).toBe(false);
    expect(game.move(0.5, 2)).toBe(false);
    expect(game.move(0, 2)).toBe(true);
    expect(game.move(0, 2)).toBe(false);
    expect(game.move(1, 2)).toBe(false);
    expect(game.towers.flat().sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(game.moves).toBe(1);
  });
  it('evaluates both truth values and removes escaped enemies exactly once', () => {
    const game = new FlashcardTowerDefense();
    game.tickSteps(120);
    expect(game.answer(1, true)).toBe(true);
    game.tickSteps(120);
    expect(game.answer(2, false)).toBe(true);
    expect(game.score).toBe(200);
    expect(game.answer(2, false)).toBe(false);
    game.tickSteps(120);
    expect(game.answer(3, false)).toBe(false);
    game.tickSteps(600);
    game.tickSteps(30);
    expect(game.enemies.some((enemy) => enemy.id === 3)).toBe(false);
    expect(game.lives).toBe(2);
    const lives = game.lives;
    game.tickSteps(1);
    expect(game.lives).toBe(lives);
  });
  it('loses on three escapes, freezes terminal state, and rejects non-finite timing', () => {
    const game = new FlashcardTowerDefense();
    game.tickSteps(1200);
    expect(game.lost).toBe(true);
    expect(game.complete).toBe(false);
    const before = JSON.stringify(game.enemies);
    game.tickSteps(600);
    expect(JSON.stringify(game.enemies)).toBe(before);
    expect(() => game.tick(Number.NaN)).toThrow();
  });
  it('keeps fractional frame timing equal to fixed 60 Hz steps', () => {
    const fractional = new FlashcardTowerDefense(),
      fixed = new FlashcardTowerDefense();
    for (let frame = 0; frame < 360; frame++) fractional.tick(1 / 120);
    fixed.tickSteps(180);
    expect(fractional.enemies).toEqual(fixed.enemies);
    expect(fractional.lives).toBe(fixed.lives);
  });
  it('replays identical deterministic ticks and answers and requires five kills to win', () => {
    const session = new GameSession('FlashcardTowerDefense');
    for (let index = 0; index < 5; index++) {
      session.tick(120);
      session.answer([true, false, true, false][index % 4]!);
      if (index === 0) expect(validateCompletion(session.gameId, session.actions).complete).toBe(false);
    }
    expect(session.complete).toBe(true);
    expect(validateCompletion(session.gameId, session.actions)).toEqual({
      complete: true,
      score: session.state.score,
    });
    const actions = session.actions.length;
    session.tick();
    session.answer(true);
    expect(session.actions).toHaveLength(actions);
  });
  it('rejects invented spawns, missing enemies, time inflation and invalid puzzle moves', () => {
    expect(
      validateCompletion('FlashcardTowerDefense', [{ type: 'spawn', lane: 0 }] as unknown as GameAction[])
        .complete,
    ).toBe(false);
    expect(
      validateCompletion('FlashcardTowerDefense', [{ type: 'answer', enemyId: 1, answer: true }]).complete,
    ).toBe(false);
    expect(validateCompletion('FlashcardTowerDefense', [{ type: 'tick', steps: Infinity }]).complete).toBe(
      false,
    );
    expect(validateCompletion('TowersOfHanoi', [{ type: 'move', from: 0, to: 0 }]).complete).toBe(false);
  });
});

describe('input session lifecycle', () => {
  it('pause stops both actions and enemy time; reset clears selection, time and result', () => {
    const session = new GameSession('FlashcardTowerDefense');
    session.tick(120);
    session.paused = true;
    const before = JSON.stringify(session.state);
    expect(session.tick(600)).toBe(false);
    expect(session.answer(true)).toBe(false);
    expect(JSON.stringify(session.state)).toBe(before);
    session.paused = false;
    session.answer(true);
    expect(session.state.score).toBe(100);
    session.reset();
    expect(session.actions).toHaveLength(0);
    expect(session.state.score).toBe(0);
    expect((session.state as FlashcardTowerDefense).enemies).toHaveLength(0);
    session.reset('SortingRace');
    session.choose(0);
    session.reset();
    expect(session.selected).toBe(-1);
  });
  it('caps timestep backlog and clears it on resume/reset', () => {
    const loop = new FixedTimestepLoop(60);
    let steps = 0;
    loop.advance(500, () => steps++);
    expect(steps).toBeLessThanOrEqual(8);
    loop.reset();
    expect(loop.advance(0, () => steps++)).toBe(0);
    expect(loop.advance(Infinity, () => steps++)).toBe(0);
  });
  it('uses validated server response and exposes zero tokens for replayed rewards', async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ tokens_awarded: 0, idempotent: true }))) as typeof fetch;
    const client = createServerRewardClient(fetcher);
    expect(
      await client.award(
        'NQueens',
        [1, 3, 0, 2].map((column, row) => ({ type: 'place', row, column })),
      ),
    ).toEqual({ tokensAwarded: 0 });
    const bad = createServerRewardClient(
      (async () => new Response(JSON.stringify({ tokens_awarded: -1 }))) as typeof fetch,
    );
    await expect(bad.award('SortingRace', [{ type: 'swap', left: 0, right: 1 }])).rejects.toThrow();
  });
});
