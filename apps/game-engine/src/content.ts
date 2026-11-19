import type { GameDifficulty, VaultGameId } from './catalog';
import type { GamePublicQuestion } from '@studyvault/types';
import { EXPANDED_QUESTIONS } from './expanded-content';

export type ContentSource = { label: string; url: string };
export type ReviewedQuestion = {
  id: string;
  objective_id: string;
  prompt: string;
  choices: readonly string[];
  answer: number;
  explanation: string;
  source: ContentSource;
  activity?: GamePublicQuestion['activity'];
  level?: GameDifficulty;
  solution?: {
    line?: number;
    repair?: number;
    node_ids?: readonly string[];
    step_ids?: readonly string[];
    dependencies?: readonly (readonly [string, string])[];
  };
};

const data: ContentSource = {
  label: 'Python tutorial: data structures',
  url: 'https://docs.python.org/3/tutorial/datastructures.html',
};
const flow: ContentSource = {
  label: 'Python tutorial: control flow',
  url: 'https://docs.python.org/3/tutorial/controlflow.html',
};
const intro: ContentSource = {
  label: 'Python tutorial: numbers and lists',
  url: 'https://docs.python.org/3/tutorial/introduction.html',
};

/** Authored, deterministic fixtures checked against the linked Python tutorial.
 * Keys live in this module, never in public question payloads. No generated or
 * learner-imported content enters a game loop. Human editorial acceptance remains
 * a release gate; these fixtures make no claim about career readiness.
 */
const concepts: ReviewedQuestion[] = [
  {
    id: 'concept-list',
    objective_id: 'python.collections',
    prompt: 'Match: list',
    choices: ['An ordered mutable sequence', 'A test that repeats forever', 'A function parameter'],
    answer: 0,
    explanation: 'A list keeps elements in order and permits changes.',
    source: intro,
  },
  {
    id: 'concept-append',
    objective_id: 'python.collections',
    prompt: 'Match: append',
    choices: ['Delete the first element', 'Add one item at the end', 'Sort a sequence'],
    answer: 1,
    explanation: 'append adds its argument as one new final item.',
    source: data,
  },
  {
    id: 'concept-range',
    objective_id: 'python.iteration',
    prompt: 'Match: range(3)',
    choices: ['1, 2, 3', '0, 1, 2, 3', '0, 1, 2'],
    answer: 2,
    explanation: 'A range excludes its stop value.',
    source: flow,
  },
  {
    id: 'concept-pop',
    objective_id: 'python.collections',
    prompt: 'Match: pop() on a nonempty list',
    choices: ['Return and remove the last item', 'Remove every item', 'Copy the list'],
    answer: 0,
    explanation: 'Without an index, pop returns the final item and removes it.',
    source: data,
  },
  {
    id: 'concept-modulo',
    objective_id: 'python.arithmetic',
    prompt: 'Match: % for integers',
    choices: ['Exponentiation', 'Remainder', 'Floor division'],
    answer: 1,
    explanation: 'The remainder operator gives what is left after division.',
    source: intro,
  },
  {
    id: 'concept-copy',
    objective_id: 'python.collections',
    prompt: 'Match: list.copy()',
    choices: ['A deep recursive copy', 'A sort in place', 'A shallow copy'],
    answer: 2,
    explanation: 'copy makes a new list, retaining references to nested elements.',
    source: data,
  },
  {
    id: 'concept-elif',
    objective_id: 'python.branching',
    prompt: 'Match: elif',
    choices: ['An additional conditional branch', 'The end of a loop', 'A collection type'],
    answer: 0,
    explanation: 'elif adds another condition after an if branch.',
    source: flow,
  },
];

const recall: ReviewedQuestion[] = [
  {
    id: 'recall-branch',
    objective_id: 'python.branching',
    prompt: 'When does the else branch of an if statement run?',
    choices: [
      'When no preceding if or elif condition was true',
      'After every true condition',
      'Only inside a for loop',
    ],
    answer: 0,
    explanation:
      'An if/elif/else chain runs the first true branch, or else if all preceding conditions were false.',
    source: flow,
  },
  {
    id: 'recall-range',
    objective_id: 'python.iteration',
    prompt: 'Which values does range(2) produce?',
    choices: ['1, 2', '0, 1', '0, 1, 2'],
    answer: 1,
    explanation: 'Starting at zero and stopping before two gives 0 and 1.',
    source: flow,
  },
  {
    id: 'recall-power',
    objective_id: 'python.arithmetic',
    prompt: 'Which Python operator computes a power?',
    choices: ['**', '^', '//'],
    answer: 0,
    explanation: 'Python uses ** for exponentiation.',
    source: intro,
  },
  {
    id: 'recall-index',
    objective_id: 'python.collections',
    prompt: 'What is the index of the first list element?',
    choices: ['1', '-2', '0'],
    answer: 2,
    explanation: 'Python sequence indexing starts at zero.',
    source: intro,
  },
  {
    id: 'recall-sort',
    objective_id: 'python.collections',
    prompt: 'What does items.sort() do?',
    choices: ['Return a reversed copy', 'Reorder items in place', 'Append an item'],
    answer: 1,
    explanation: 'sort changes the original list and returns None.',
    source: data,
  },
  {
    id: 'recall-for',
    objective_id: 'python.iteration',
    prompt: 'What does a Python for loop visit in a list?',
    choices: ['Its items in sequence order', 'Only numeric items', 'Only the last item'],
    answer: 0,
    explanation: 'for iterates through the supplied sequence in its order.',
    source: flow,
  },
  {
    id: 'recall-floor',
    objective_id: 'python.arithmetic',
    prompt: 'What is 11 // 4?',
    choices: ['2.75', '3', '2'],
    answer: 2,
    explanation: 'Floor division rounds the quotient down to 2.',
    source: intro,
  },
  {
    id: 'recall-extend',
    objective_id: 'python.collections',
    prompt: 'What does a.extend([2, 3]) add to a?',
    choices: ['One nested list', 'The items 2 and 3', 'Only 3'],
    answer: 1,
    explanation: 'extend appends each item of the iterable.',
    source: data,
  },
];

const trace: ReviewedQuestion[] = [
  {
    id: 'trace-add',
    objective_id: 'python.arithmetic',
    prompt: 'Predict the output (Python 3):\nprint(2 + 3 * 2)',
    choices: ['10', '8', '12'],
    answer: 1,
    explanation: 'Multiplication happens first: 2 + 6 is 8.',
    source: intro,
  },
  {
    id: 'trace-list',
    objective_id: 'python.collections',
    prompt: 'Predict the output (Python 3):\na = [4, 7]\na.append(9)\nprint(len(a))',
    choices: ['2', '9', '3'],
    answer: 2,
    explanation: 'append adds one element, so there are three elements.',
    source: data,
  },
  {
    id: 'trace-range',
    objective_id: 'python.iteration',
    prompt: 'Predict the output (Python 3):\ntotal = 0\nfor n in range(3):\n    total += n\nprint(total)',
    choices: ['3', '6', '2'],
    answer: 0,
    explanation: 'The loop adds 0, 1 and 2.',
    source: flow,
  },
  {
    id: 'trace-pop',
    objective_id: 'python.collections',
    prompt: 'Predict the output (Python 3):\na = [5, 8, 13]\nx = a.pop()\nprint(x)',
    choices: ['5', '13', '8'],
    answer: 1,
    explanation: 'pop without an index removes and returns 13.',
    source: data,
  },
  {
    id: 'trace-if',
    objective_id: 'python.branching',
    prompt: 'Predict the output (Python 3):\nn = 4\nif n > 5:\n    print("high")\nelse:\n    print("low")',
    choices: ['high', '4', 'low'],
    answer: 2,
    explanation: 'Four is not greater than five, so the else branch runs.',
    source: flow,
  },
  {
    id: 'trace-copy',
    objective_id: 'python.collections',
    prompt: 'Predict the output (Python 3):\na = [1, 2]\nb = a.copy()\nb.append(3)\nprint(len(a))',
    choices: ['2', '3', '1'],
    answer: 0,
    explanation: 'Appending to the copied list leaves the original length unchanged.',
    source: data,
  },
  {
    id: 'trace-modulo',
    objective_id: 'python.arithmetic',
    prompt: 'Predict the output (Python 3):\nprint(14 % 4)',
    choices: ['3', '2', '4'],
    answer: 1,
    explanation: 'Four fits three times into fourteen, leaving two.',
    source: intro,
  },
];

for (const question of [...concepts, ...recall, ...trace]) {
  Object.freeze(question.choices);
  Object.freeze(question.source);
  Object.freeze(question);
}

export const AUTHORED_QUESTIONS: Readonly<Record<string, readonly ReviewedQuestion[]>> = Object.freeze({
  ConceptMatch: Object.freeze(concepts),
  RetrievalSprint: Object.freeze(recall),
  FlashcardTowerDefense: Object.freeze(recall),
  CodeTrace: Object.freeze(trace),
  ...EXPANDED_QUESTIONS,
  AdaptiveQuiz: Object.freeze([
    ...concepts.map((question) => ({
      ...question,
      id: `adaptive-easy-${question.id}`,
      level: 'easy' as const,
    })),
    ...recall.map((question) => ({
      ...question,
      id: `adaptive-medium-${question.id}`,
      level: 'medium' as const,
    })),
    ...trace.map((question) => ({ ...question, id: `adaptive-hard-${question.id}`, level: 'hard' as const })),
  ]),
  ExamEscape: Object.freeze(trace.map((question) => ({ ...question, id: `escape-${question.id}` }))),
});

/** Version 1 selects a bounded subset; the seed controls its order, never keys. */
export function questionCount(gameId: VaultGameId, difficulty: GameDifficulty): number {
  if (!AUTHORED_QUESTIONS[gameId]) return 0;
  return gameId === 'FlashcardTowerDefense' ? 5 : { easy: 3, medium: 5, hard: 7 }[difficulty];
}

export function seededOrder<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let value = seed >>> 0;
  for (let index = copy.length - 1; index > 0; index--) {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    const other = value % (index + 1);
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

export function questionsFor(config: {
  game_id: VaultGameId;
  difficulty: GameDifficulty;
  seed: number;
  objective_id?: string;
}): readonly ReviewedQuestion[] {
  const scoped = AUTHORED_QUESTIONS[config.game_id] ?? [];
  if (config.objective_id !== undefined && scoped.length === 0)
    throw new Error('objective scope is not supported for this game');
  const matching =
    config.objective_id === undefined
      ? scoped
      : scoped.filter((question) => question.objective_id === config.objective_id);
  if (scoped.length > 0 && matching.length === 0)
    throw new Error('no questions are available for this objective scope');
  const selected = seededOrder(matching, config.seed).slice(
    0,
    questionCount(config.game_id, config.difficulty),
  );
  if (!['DebuggingDetective', 'SQLDetective', 'DataDetective', 'ExamEscape'].includes(config.game_id))
    return selected;
  return selected.map((question, index) => {
    if (question.activity?.kind === 'debug') {
      const activity = question.activity;
      const repairIndices = seededOrder(
        activity.repairs.map((_, i) => i),
        config.seed + index + 1,
      );
      return {
        ...question,
        activity: { ...activity, repairs: repairIndices.map((i) => activity.repairs[i]!) },
        solution: { ...question.solution, repair: repairIndices.indexOf(question.solution!.repair!) },
      };
    }
    const indices = seededOrder(
      question.choices.map((_, i) => i),
      config.seed + index + 1,
    );
    return {
      ...question,
      choices: indices.map((i) => question.choices[i]!),
      answer: indices.indexOf(question.answer),
    };
  });
}
