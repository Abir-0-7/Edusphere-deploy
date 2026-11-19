import type { GameDifficulty, GameId } from '@studyvault/types';

export const GAME_IDS = [
  'SortingRace',
  'NQueens',
  'TowersOfHanoi',
  'FlashcardTowerDefense',
  'ConceptMatch',
  'RetrievalSprint',
  'CodeTrace',
  'DebuggingDetective',
  'SQLDetective',
  'GraphPath',
  'ProofBuilder',
  'DataDetective',
  'AdaptiveQuiz',
  'ExamEscape',
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
  {
    id: 'DebuggingDetective',
    title: 'Debugging Detective',
    objective: 'Locate a Python bug and choose a repair for a fixed regression case.',
    controls: 'Select the faulty line and a replacement, then submit your repair. No code is executed.',
    duration: '3-6 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'SQLDetective',
    title: 'SQL Detective',
    objective: 'Reason about SQL query results using small immutable data tables.',
    controls: 'Inspect the table and query, then choose its result. Queries are never executed.',
    duration: '3-6 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'GraphPath',
    title: 'Graph Path',
    objective: 'Build a shortest path through an undirected, unweighted graph.',
    controls:
      'Choose nodes in route order, then submit. Any shortest route is valid; choose no path when disconnected.',
    duration: '3-7 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'ProofBuilder',
    title: 'Proof Builder',
    objective: 'Order algebraic proof steps while respecting their logical dependencies.',
    controls: 'Arrange all proof steps and submit. Independent steps may be placed in either order.',
    duration: '3-7 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'DataDetective',
    title: 'Data Detective',
    objective: 'Use a small data table to distinguish supported evidence from inference.',
    controls: 'Inspect the supplied values and units, then choose the supported claim.',
    duration: '3-6 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'AdaptiveQuiz',
    title: 'Adaptive Quiz',
    objective: 'Practise Python with the next question level adjusted from this session’s answers.',
    controls: 'Choose an answer at your own pace. This provisional practice rule does not measure mastery.',
    duration: '3-6 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
  {
    id: 'ExamEscape',
    title: 'Exam Escape',
    objective: 'Open a sequence of Python puzzle locks using untimed reasoning.',
    controls: 'Solve each room’s lock to advance. Three wrong attempts end the run; reading has no timer.',
    duration: '4-8 minutes',
    difficulties: ['easy', 'medium', 'hard'],
  },
];

/** Preserve the legacy export while giving callers a concise catalog name. */
export const gameCatalog = GAME_CATALOG;
