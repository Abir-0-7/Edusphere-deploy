import { SortingRace } from './games/sorting-race';
import { NQueens } from './games/n-queens';
import { TowersOfHanoi } from './games/hanoi';
import { FlashcardTowerDefense } from './games/tower-defense';
import type { GameCompletionRequest } from '@studyvault/types';

export type GameAction = GameCompletionRequest['actions'][number];

export { TOWER_CARDS } from './games/tower-cards';

export type Completion = { complete: boolean; score: number };

export function validateCompletion(gameId: string, rawActions: readonly GameAction[]): Completion {
  if (rawActions.length === 0 || rawActions.length > 2000) return { complete: false, score: 0 };
  if (gameId === 'SortingRace') {
    const game = new SortingRace([4, 1, 3, 2]);
    for (const action of rawActions)
      if (action.type !== 'swap' || !game.swap(action.left, action.right))
        return { complete: false, score: 0 };
    return { complete: game.complete, score: game.score };
  }
  if (gameId === 'NQueens') {
    const game = new NQueens(4);
    for (const action of rawActions)
      if (action.type !== 'place' || !game.place(action.row, action.column))
        return { complete: false, score: 0 };
    return { complete: game.complete, score: game.score };
  }
  if (gameId === 'TowersOfHanoi') {
    const game = new TowersOfHanoi(4);
    for (const action of rawActions)
      if (action.type !== 'move' || !game.move(action.from, action.to)) return { complete: false, score: 0 };
    return { complete: game.complete, score: game.score };
  }
  if (gameId === 'FlashcardTowerDefense') {
    const game = new FlashcardTowerDefense();
    let totalSteps = 0;
    for (const action of rawActions) {
      if (game.complete || game.lost) return { complete: false, score: 0 };
      if (action.type === 'tick') {
        if (!Number.isInteger(action.steps) || action.steps < 1 || action.steps > 600)
          return { complete: false, score: 0 };
        totalSteps += action.steps;
        if (totalSteps > 18000) return { complete: false, score: 0 };
        game.tickSteps(action.steps);
      } else if (action.type === 'answer') {
        if (!game.enemies.some((enemy) => enemy.id === action.enemyId)) return { complete: false, score: 0 };
        game.answer(action.enemyId, action.answer);
      } else return { complete: false, score: 0 };
    }
    return { complete: game.complete && !game.lost, score: game.score };
  }
  return { complete: false, score: 0 };
}
