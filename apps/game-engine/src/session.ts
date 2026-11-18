import type {
  GameConfig,
  GamePublicView,
  GameSnapshot,
  OrderedGameAction,
  VersionedGameAction,
} from '@studyvault/types';
import { AUTHORED_QUESTIONS, questionsFor, seededOrder, type ReviewedQuestion } from './content';
import { GAME_IDS, type GameDifficulty, type VaultGameId } from './catalog';

export type { GameConfig, GameSnapshot, OrderedGameAction };
export type GameAction = VersionedGameAction;
export type GameFeedback = NonNullable<GamePublicView['feedback']>;

export type GameState = GameSnapshot & {
  values: number[];
  columns: number[];
  towers: number[][];
  questionIndex: number;
  feedback: GameFeedback | null;
  correct: number;
  mistakes: number;
  hints: number;
  moves: number;
  hintText: string | null;
};

export type GameResult = {
  status: 'playing' | 'won' | 'lost';
  score: number;
  mistakes: number;
  hints: number;
  explanation: string;
  rewardEligible: boolean;
};

const MAX_ACTIONS = 500;
const INTEGER = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isGameId = (value: string): value is VaultGameId => (GAME_IDS as readonly string[]).includes(value);

function assertConfig(config: GameConfig): void {
  const keys = config ? Object.keys(config).sort().join('|') : '';
  if (
    !config ||
    ![
      'difficulty|game_id|practice|seed|version',
      'difficulty|game_id|objective_id|practice|seed|version',
    ].includes(keys)
  ) {
    throw new Error('malformed game configuration');
  }
  if (
    config.version !== 1 ||
    !isGameId(config.game_id) ||
    !['easy', 'medium', 'hard'].includes(config.difficulty)
  ) {
    throw new Error('unsupported game configuration');
  }
  if (!INTEGER(config.seed) || config.seed < 0 || config.seed > 0xffff_ffff)
    throw new Error('seed must be uint32');
  if (typeof config.practice !== 'boolean') throw new Error('practice must be boolean');
  if (
    config.objective_id !== undefined &&
    !['python.arithmetic', 'python.collections', 'python.iteration', 'python.branching'].includes(
      config.objective_id,
    )
  )
    throw new Error('unknown objective scope');
  if (!isQuestionGame(config.game_id)) {
    if (config.objective_id !== undefined) throw new Error('objective scope is not supported for this game');
    return;
  }
  if (questionsFor(config).length === 0) throw new Error('no questions are available for this game');
}

function dimensions(config: GameConfig): { queenSize: number; diskCount: number } {
  return {
    queenSize: { easy: 4, medium: 6, hard: 8 }[config.difficulty],
    diskCount: { easy: 3, medium: 4, hard: 5 }[config.difficulty],
  };
}

function initialValues(config: GameConfig): number[] {
  const sets: Record<GameDifficulty, number[]> = {
    easy: [2, -1, 2, 0],
    medium: [3, -2, 1, 3, 0, -1],
    hard: [4, -3, 2, 4, -2, 0, 1, -1],
  };
  const values = seededOrder(sets[config.difficulty], config.seed);
  if (sorted(values)) [values[0], values[1]] = [values[1]!, values[0]!];
  return values;
}

function initialState(config: GameConfig): GameState {
  assertConfig(config);
  const { queenSize, diskCount } = dimensions(config);
  return {
    config: { ...config },
    actions: [],
    values: initialValues(config),
    columns: Array(queenSize).fill(-1),
    towers: [Array.from({ length: diskCount }, (_, index) => diskCount - index), [], []],
    questionIndex: 0,
    feedback: null,
    correct: 0,
    mistakes: 0,
    hints: 0,
    moves: 0,
    hintText: null,
  };
}

function isQuestionGame(gameId: VaultGameId): boolean {
  return (
    gameId === 'FlashcardTowerDefense' ||
    gameId === 'ConceptMatch' ||
    gameId === 'RetrievalSprint' ||
    gameId === 'CodeTrace'
  );
}

function questions(config: GameConfig): readonly ReviewedQuestion[] {
  return questionsFor(config);
}

function assertOrderedAction(ordered: OrderedGameAction, expectedSeq: number): void {
  if (
    !ordered ||
    !INTEGER(ordered.seq) ||
    ordered.seq !== expectedSeq ||
    !ordered.action ||
    typeof ordered.action.type !== 'string'
  ) {
    throw new Error(`action sequence must be exactly ${expectedSeq}`);
  }
  if (Object.keys(ordered).sort().join('|') !== 'action|seq') throw new Error('malformed ordered action');
  if (ordered.seq < 1 || ordered.seq > MAX_ACTIONS) throw new Error('action limit exceeded');
  const action = ordered.action;
  const exactKeys: Record<GameAction['type'], readonly string[]> = {
    swap: ['type', 'left', 'right'],
    place: ['type', 'row', 'column'],
    move: ['type', 'from', 'to'],
    answer: ['type', 'question_id', 'choice'],
    undo: ['type'],
    hint: ['type'],
  };
  const keys = Object.keys(action).sort();
  if (!exactKeys[action.type] || keys.join('|') !== [...exactKeys[action.type]].sort().join('|'))
    throw new Error('malformed game action');
  switch (action.type) {
    case 'swap':
      if (
        !INTEGER(action.left) ||
        !INTEGER(action.right) ||
        action.left < 0 ||
        action.right < 0 ||
        action.left > 15 ||
        action.right > 15
      )
        throw new Error('invalid swap');
      break;
    case 'place':
      if (
        !INTEGER(action.row) ||
        !INTEGER(action.column) ||
        action.row < 0 ||
        action.column < 0 ||
        action.row > 11 ||
        action.column > 11
      )
        throw new Error('invalid queen placement');
      break;
    case 'move':
      if (
        !INTEGER(action.from) ||
        !INTEGER(action.to) ||
        action.from < 0 ||
        action.from > 2 ||
        action.to < 0 ||
        action.to > 2
      )
        throw new Error('invalid peg');
      break;
    case 'answer':
      if (
        typeof action.question_id !== 'string' ||
        action.question_id.length < 1 ||
        action.question_id.length > 128 ||
        !INTEGER(action.choice) ||
        action.choice < 0 ||
        action.choice > 15
      )
        throw new Error('invalid answer');
      break;
    case 'undo':
    case 'hint':
      break;
    default: {
      const neverAction: never = action;
      throw new Error(`unknown action ${(neverAction as { type: string }).type}`);
    }
  }
}

function sorted(values: readonly number[]): boolean {
  return values.every(
    (value, index) => index === 0 || (values[index - 1] ?? Number.NEGATIVE_INFINITY) <= value,
  );
}

function queenSolved(columns: readonly number[]): boolean {
  return columns.every(
    (column, row) =>
      column >= 0 &&
      columns.every(
        (other, otherRow) =>
          row === otherRow ||
          (other >= 0 && other !== column && Math.abs(other - column) !== Math.abs(otherRow - row)),
      ),
  );
}

function questionComplete(state: GameState): boolean {
  return state.questionIndex >= questions(state.config).length;
}

function questionWon(state: GameState): boolean {
  return (
    questionComplete(state) &&
    state.mistakes < 3 &&
    state.correct >= Math.ceil(questions(state.config).length * 0.6)
  );
}

function solved(state: GameState): boolean {
  switch (state.config.game_id) {
    case 'SortingRace':
      return sorted(state.values);
    case 'NQueens':
      return queenSolved(state.columns);
    case 'TowersOfHanoi':
      return state.towers[2]?.length === dimensions(state.config).diskCount;
    default:
      return questionWon(state);
  }
}

function applyPrimitive(state: GameState, action: GameAction): void {
  if (action.type !== 'hint') state.hintText = null;
  switch (action.type) {
    case 'swap': {
      if (
        state.config.game_id !== 'SortingRace' ||
        action.left >= state.values.length ||
        action.right >= state.values.length
      )
        throw new Error('swap is not valid for this game');
      if (action.left === action.right) throw new Error('swap positions must differ');
      [state.values[action.left], state.values[action.right]] = [
        state.values[action.right]!,
        state.values[action.left]!,
      ];
      state.moves++;
      return;
    }
    case 'place': {
      if (
        state.config.game_id !== 'NQueens' ||
        action.row >= state.columns.length ||
        action.column >= state.columns.length
      )
        throw new Error('placement is not valid for this game');
      state.columns[action.row] = action.column;
      state.moves++;
      return;
    }
    case 'move': {
      if (state.config.game_id !== 'TowersOfHanoi' || action.from === action.to)
        throw new Error('move is not valid for this game');
      const source = state.towers[action.from];
      const target = state.towers[action.to];
      if (!source || !target || source.length === 0) throw new Error('cannot move from an empty peg');
      const disk = source[source.length - 1];
      const top = target[target.length - 1];
      if (disk === undefined || (top !== undefined && top < disk))
        throw new Error('cannot place a larger disk on a smaller disk');
      target.push(source.pop()!);
      state.moves++;
      return;
    }
    case 'answer': {
      if (!isQuestionGame(state.config.game_id)) throw new Error('answers are not valid for this game');
      const question = questions(state.config)[state.questionIndex];
      if (!question || action.question_id !== question.id || action.choice >= question.choices.length)
        throw new Error('answer is out of order');
      const correct = action.choice === question.answer;
      state.feedback = {
        question_id: question.id,
        correct,
        explanation: question.explanation,
        source: { ...question.source },
      };
      state.questionIndex++;
      if (correct) state.correct++;
      else state.mistakes++;
      return;
    }
    case 'hint':
      if (!state.config.practice) throw new Error('hints are available in practice mode only');
      state.hints++;
      state.hintText =
        state.config.game_id === 'SortingRace'
          ? 'Find the leftmost pair that is out of order.'
          : state.config.game_id === 'NQueens'
            ? 'Check columns and both diagonal directions for conflicts.'
            : state.config.game_id === 'TowersOfHanoi'
              ? 'Move the smallest disk every other turn; alternate its legal destination.'
              : 'Slow down and identify what each Python operation changes.';
      return;
    case 'undo':
      throw new Error('undo is replayed by the session reducer');
  }
}

function replay(config: GameConfig, actionLog: readonly OrderedGameAction[]): GameState {
  const state = initialState(config);
  const history: GameState[] = [];
  for (let index = 0; index < actionLog.length; index++) {
    const ordered = actionLog[index]!;
    assertOrderedAction(ordered, index + 1);
    if (ordered.action.type === 'undo') {
      const previous = history.pop();
      if (!config.practice || !previous)
        throw new Error('undo is available only in practice with a previous action');
      Object.assign(state, previous);
      continue;
    }
    if (getGameResult(state).status !== 'playing')
      throw new Error('snapshot contains actions after completion');
    history.push({
      config: state.config,
      actions: [],
      values: [...state.values],
      columns: [...state.columns],
      towers: state.towers.map((tower) => [...tower]),
      questionIndex: state.questionIndex,
      feedback: state.feedback ? { ...state.feedback, source: { ...state.feedback.source } } : null,
      correct: state.correct,
      mistakes: state.mistakes,
      hints: state.hints,
      moves: state.moves,
      hintText: state.hintText,
    });
    applyPrimitive(state, ordered.action);
  }
  state.actions = actionLog.map((entry) => ({ seq: entry.seq, action: { ...entry.action } as GameAction }));
  return state;
}

export function createGame(config: GameConfig): GameState {
  return initialState(config);
}

/** Apply an ordered action by replaying the bounded event log. This is deliberately
 * immutable: server retries can safely compare serialized snapshots. */
export function applyGame(state: GameState, ordered: OrderedGameAction): GameState {
  assertOrderedAction(ordered, state.actions.length + 1);
  if (state.actions.length >= MAX_ACTIONS) throw new Error('action limit exceeded');
  if (getGameResult(state).status !== 'playing' && !(ordered.action.type === 'undo' && state.config.practice))
    throw new Error('game session is already complete');
  return replay(state.config, [...state.actions, ordered]);
}

export function serializeGame(state: GameState): GameSnapshot {
  return {
    config: { ...state.config },
    actions: state.actions.map((entry) => ({ seq: entry.seq, action: { ...entry.action } as GameAction })),
  };
}

export function restoreGame(snapshot: GameSnapshot): GameState {
  if (!snapshot || Object.keys(snapshot).sort().join('|') !== 'actions|config')
    throw new Error('malformed snapshot');
  assertConfig(snapshot.config);
  if (!Array.isArray(snapshot.actions) || snapshot.actions.length > MAX_ACTIONS)
    throw new Error('invalid snapshot');
  if (snapshot.actions.some((action, index) => !action || action.seq !== index + 1))
    throw new Error('invalid snapshot sequence');
  return replay(snapshot.config, snapshot.actions);
}

export function getPublicQuestion(state: GameState): GamePublicView['question'] {
  if (!isQuestionGame(state.config.game_id) || getGameResult(state).status !== 'playing') return null;
  const question = questions(state.config)[state.questionIndex];
  return question
    ? {
        id: question.id,
        prompt: question.prompt,
        choices: [...question.choices],
        source: { ...question.source },
      }
    : null;
}

export function getGameResult(state: GameState): GameResult {
  const lost =
    isQuestionGame(state.config.game_id) &&
    (state.mistakes >= 3 || (questionComplete(state) && !questionWon(state)));
  const won = !lost && solved(state);
  const status = won ? 'won' : lost ? 'lost' : 'playing';
  const baseScore = isQuestionGame(state.config.game_id)
    ? state.correct * 100 - state.mistakes * 25 - state.hints * 10
    : state.config.game_id === 'NQueens'
      ? state.columns.length * 100 - state.moves * 5
      : state.config.game_id === 'TowersOfHanoi'
        ? Math.max(100, 1000 - state.moves * 10)
        : Math.max(100, 1000 - state.moves * 25);
  const score =
    status === 'playing' ? 0 : Math.max(0, status === 'lost' ? Math.floor(baseScore / 2) : baseScore);
  const puzzleExplanation =
    state.config.game_id === 'TowersOfHanoi'
      ? `Move only a top disk onto a larger disk or an empty peg. Optimal reference: ${2 ** dimensions(state.config).diskCount - 1} moves; your moves: ${state.moves}.`
      : state.config.game_id === 'NQueens'
        ? 'A solution needs one queen per row, with no shared columns and no diagonal attacks.'
        : state.config.game_id === 'SortingRace'
          ? 'Arrange values in nondecreasing order. Equal values are allowed; each swap preserves the original multiset.'
          : null;
  const detail =
    state.hintText ??
    state.feedback?.explanation ??
    puzzleExplanation ??
    (won
      ? 'Completed with a deterministic server replay.'
      : lost
        ? 'The session ended after repeated incorrect answers.'
        : 'Keep going; every action is checked against the versioned rules.');
  const rule = isQuestionGame(state.config.game_id)
    ? ` Clear at least ${Math.ceil(questions(state.config).length * 0.6)} of ${questions(state.config).length} questions correctly (60%, rounded up); 3 mistakes end the round. This score records engagement, not mastery.`
    : '';
  const explanation = detail + rule;
  return {
    status,
    score,
    mistakes: state.mistakes,
    hints: state.hints,
    explanation,
    rewardEligible: status === 'won' && !state.config.practice && state.hints === 0,
  };
}

export const reviewedQuestionCount = (gameId: VaultGameId): number => AUTHORED_QUESTIONS[gameId]?.length ?? 0;
