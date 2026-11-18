import type { GameDifficulty, GameId } from '@studyvault/types';

export const GAME_IDS = [
  'SortingRace',
  'NQueens',
  'TowersOfHanoi',
  'FlashcardTowerDefense',
  'ConceptMatch',
  'RetrievalSprint',
  'CodeTrace',
] as const satisfies readonly GameId[];

export type VaultGameId = GameId;
export type { GameDifficulty };

export const GAME_CATALOG: ReadonlyArray<{
  id: VaultGameId;
  title: string;
  objective: string;
  controls: string;
  duration: string;
  difficulties: readonly GameDifficulty[];
}> = [
  {
    id: 'SortingRace',
    title: 'Sorting Race',
    objective: 'Order integers, including negatives and duplicates.',
    controls: 'Select two positions to swap. Keyboard: Tab then Enter or Space.',
    duration: '2–5 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'NQueens',
    title: 'N-Queens',
    objective: 'Place one queen per row without shared columns or diagonals.',
    controls: 'Choose a square in each row; choose another square to move that queen.',
    duration: '3–10 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'TowersOfHanoi',
    title: 'Towers of Hanoi',
    objective: 'Move the stack to the final peg while preserving disk order.',
    controls:
      'Select the source peg, then the destination. Only move a top disk onto a larger disk or empty peg.',
    duration: '2–10 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'FlashcardTowerDefense',
    title: 'Recall Defense',
    objective: 'Recall Python facts to clear five reading waves.',
    controls: 'Read at your own pace, then select an answer. No timer or movement penalty.',
    duration: '3–5 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'ConceptMatch',
    title: 'Concept Match',
    objective: 'Match Python concepts to their meanings.',
    controls: 'Read the concept and choose its matching definition.',
    duration: '2–4 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'RetrievalSprint',
    title: 'Retrieval Sprint',
    objective: 'Retrieve Python knowledge without a speed penalty.',
    controls:
      'Choose an answer for each prompt. This is casual practice and does not change scheduled reviews.',
    duration: '2–4 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'CodeTrace',
    title: 'Code Trace',
    objective: 'Predict the output of small, fixed Python programs.',
    controls: 'Trace the supplied example and choose its output. Programs are never executed.',
    duration: '3–6 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
];

/** Preserve the legacy export while giving callers a concise catalog name. */
export const gameCatalog = GAME_CATALOG;
