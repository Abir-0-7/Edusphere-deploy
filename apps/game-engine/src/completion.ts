import { SortingRace } from './games/sorting-race';
import { NQueens } from './games/n-queens';
import { TowersOfHanoi } from './games/hanoi';
import { FlashcardTowerDefense } from './games/tower-defense';

export type GameAction =
  | { type: 'swap'; left: number; right: number }
  | { type: 'place'; row: number; column: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'spawn'; lane: number; hp?: number }
  | { type: 'answer'; enemyId: number; answer: boolean };

export const TOWER_CARDS = [
  { prompt: 'The Earth orbits the Sun.', answer: true },
  { prompt: 'A triangle has four sides.', answer: false },
  { prompt: 'Water is H2O.', answer: true },
  { prompt: 'The number 9 is prime.', answer: false },
] as const;

export type Completion = { complete: boolean; score: number };

export function validateCompletion(gameId: string, rawActions: readonly GameAction[]): Completion {
  if (rawActions.length === 0 || rawActions.length > 500) return { complete: false, score: 0 };
  if (gameId === 'SortingRace') {
    const game = new SortingRace([4, 1, 3, 2]);
    for (const action of rawActions) if (action.type === 'swap') game.swap(action.left, action.right); else return { complete: false, score: 0 };
    return { complete: game.complete, score: game.score };
  }
  if (gameId === 'NQueens') {
    const game = new NQueens(4);
    for (const action of rawActions) if (action.type === 'place') game.place(action.row, action.column); else return { complete: false, score: 0 };
    return { complete: game.complete, score: game.score };
  }
  if (gameId === 'TowersOfHanoi') {
    const game = new TowersOfHanoi(4);
    for (const action of rawActions) if (action.type === 'move') game.move(action.from, action.to); else return { complete: false, score: 0 };
    return { complete: game.complete, score: game.score };
  }
  if (gameId === 'FlashcardTowerDefense') {
    const game = new FlashcardTowerDefense();
    for (const action of rawActions) {
      if (action.type === 'spawn') game.spawn(action.lane, action.hp);
      else if (action.type === 'answer') game.answer(action.enemyId, action.answer === TOWER_CARDS[(action.enemyId - 1) % TOWER_CARDS.length]?.answer);
      else return { complete: false, score: 0 };
    }
    return { complete: game.score > 0, score: game.score };
  }
  return { complete: false, score: 0 };
}
