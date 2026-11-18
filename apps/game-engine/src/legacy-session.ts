import type { GameAction } from './completion';
import { SortingRace } from './games/sorting-race';
import { NQueens } from './games/n-queens';
import { TowersOfHanoi } from './games/hanoi';
import { FlashcardTowerDefense } from './games/tower-defense';

export type LegacyGame = SortingRace | NQueens | TowersOfHanoi | FlashcardTowerDefense;
export type LegacyGameId = 'SortingRace' | 'NQueens' | 'TowersOfHanoi' | 'FlashcardTowerDefense';
export const GAME_DEFINITIONS: ReadonlyArray<{ id: LegacyGameId; label: string; instructions: string }> = [
  {
    id: 'SortingRace',
    label: 'Sorting Race',
    instructions: 'Select two tiles to swap them. Arrange numbers from smallest to largest.',
  },
  {
    id: 'NQueens',
    label: 'N-Queens',
    instructions:
      'Place one queen per row without shared columns or diagonals. Select a queen again to remove it.',
  },
  {
    id: 'TowersOfHanoi',
    label: 'Towers of Hanoi',
    instructions:
      'Select a source tower, then a destination. Move all disks to tower 3. A larger disk cannot sit on a smaller disk.',
  },
  {
    id: 'FlashcardTowerDefense',
    label: 'Flashcard Tower Defense',
    instructions:
      'Answer True or False. Defeat five enemies before losing three lives. Use the integrated Recall Defense for untimed reading waves.',
  },
];

/** Compatibility for the existing standalone four-game preview. */
export class GameSession {
  gameId: LegacyGameId;
  state!: LegacyGame;
  actions: GameAction[] = [];
  selected = -1;
  paused = false;
  message = '';
  constructor(gameId: LegacyGameId = 'SortingRace') {
    this.gameId = gameId;
    this.reset(gameId);
  }
  reset(gameId = this.gameId): void {
    this.gameId = gameId;
    this.state =
      gameId === 'SortingRace'
        ? new SortingRace([4, 1, 3, 2])
        : gameId === 'NQueens'
          ? new NQueens(4)
          : gameId === 'TowersOfHanoi'
            ? new TowersOfHanoi(4)
            : new FlashcardTowerDefense();
    this.actions = [];
    this.selected = -1;
    this.paused = false;
    this.message = '';
  }
  get complete(): boolean {
    return this.state.complete;
  }
  get lost(): boolean {
    return this.state instanceof FlashcardTowerDefense && this.state.lost;
  }
  private record(action: GameAction): void {
    const previous = this.actions.at(-1);
    if (action.type === 'tick' && previous?.type === 'tick' && previous.steps + action.steps <= 600)
      previous.steps += action.steps;
    else this.actions.push(action);
    if (this.actions.length >= 2000) {
      this.paused = true;
      this.message = 'Action limit reached. Reset to begin a new game.';
    }
  }
  choose(index: number): boolean {
    if (this.paused || this.complete || this.lost || !Number.isInteger(index)) return false;
    if (this.state instanceof NQueens) {
      const row = Math.floor(index / this.state.size),
        column = index % this.state.size;
      if (!this.state.place(row, column)) return false;
      this.record({ type: 'place', row, column });
      this.message = this.state.attacked(row, column)
        ? 'This queen is under attack. Try another column.'
        : '';
      return true;
    }
    if (!(this.state instanceof SortingRace || this.state instanceof TowersOfHanoi)) return false;
    const count = this.state instanceof SortingRace ? this.state.items.length : 3;
    if (index < 0 || index >= count) return false;
    if (this.selected === index) {
      this.selected = -1;
      return true;
    }
    if (this.selected < 0) {
      this.selected = index;
      return true;
    }
    const from = this.selected;
    this.selected = -1;
    if (this.state instanceof SortingRace) {
      if (!this.state.swap(from, index)) return false;
      this.record({ type: 'swap', left: from, right: index });
    } else {
      if (!this.state.move(from, index)) {
        this.message = 'Move a smaller disk onto an empty tower or larger disk.';
        return true;
      }
      this.record({ type: 'move', from, to: index });
      this.message = '';
    }
    return true;
  }
  answer(answer: boolean): boolean {
    if (this.paused || this.complete || this.lost || !(this.state instanceof FlashcardTowerDefense))
      return false;
    const enemy = this.state.enemies[0];
    if (!enemy) return false;
    const correct = this.state.answer(enemy.id, answer);
    this.record({ type: 'answer', enemyId: enemy.id, answer });
    this.message = correct ? 'Correct. Enemy defeated.' : 'Incorrect. The enemy moved closer.';
    return true;
  }
  tick(steps = 1): boolean {
    if (!Number.isInteger(steps) || steps < 1 || steps > 600) throw new Error('invalid replay tick size');
    if (this.paused || this.complete || this.lost || !(this.state instanceof FlashcardTowerDefense))
      return false;
    this.state.tickSteps(steps);
    this.record({ type: 'tick', steps });
    return true;
  }
}
