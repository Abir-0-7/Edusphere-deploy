import type { ReviewedQuestion } from './content';

const python = {
  label: 'Python tutorial: control flow',
  url: 'https://docs.python.org/3/tutorial/controlflow.html',
};
const collections = {
  label: 'Python tutorial: data structures',
  url: 'https://docs.python.org/3/tutorial/datastructures.html',
};
const sqlSource = {
  label: 'PostgreSQL tutorial: querying a table',
  url: 'https://www.postgresql.org/docs/18/tutorial-select.html',
};
const aggregateSource = {
  label: 'PostgreSQL tutorial: aggregate functions',
  url: 'https://www.postgresql.org/docs/18/tutorial-agg.html',
};
const graphSource = {
  label: 'Boost Graph: breadth-first search',
  url: 'https://www.boost.org/latest/libs/graph/doc/html/graph/algorithms/traversal/breadth_first_search.html',
};
const proofSource = {
  label: 'MIT: Mathematics for Computer Science',
  url: 'https://ocw.mit.edu/courses/6-042j-mathematics-for-computer-science-spring-2015/',
};
const dataSource = {
  label: 'NIST: measures of location',
  url: 'https://www.itl.nist.gov/div898/handbook/eda/section3/eda351.htm',
};
const scatterSource = {
  label: 'NIST: scatter plots and association',
  url: 'https://www.itl.nist.gov/div898/handbook/eda/section3/eda33q.htm',
};

/** Original, bounded authored practice fixtures. They await human editorial review.
 * No SQL, Python, learner input or generated code is executed by these games. */
export const DEBUG_QUESTIONS: ReviewedQuestion[] = [
  {
    id: 'debug-sum',
    objective_id: 'debugging',
    prompt: 'The regression case expects total = 6. Select the faulty line and its replacement.',
    activity: {
      kind: 'debug',
      lines: ['total = 0', 'for n in range(1, 3):', '    total += n'],
      repairs: ['for n in range(1, 4):', 'for n in range(0, 3):', 'for n in range(1, 2):'],
    },
    choices: [],
    answer: 0,
    solution: { line: 1, repair: 0 },
    explanation: 'range excludes its stop. Values 1, 2 and 3 require range(1, 4), and total is then 6.',
    source: python,
  },
  {
    id: 'debug-copy',
    objective_id: 'debugging',
    prompt: 'After the final line, a must still equal [1, 2]. Select the faulty line and its replacement.',
    activity: {
      kind: 'debug',
      lines: ['a = [1, 2]', 'b = a', 'b.append(3)'],
      repairs: ['b = a.copy()', 'b = a.append(3)', 'b = a.sort()'],
    },
    choices: [],
    answer: 0,
    solution: { line: 1, repair: 0 },
    explanation: 'A shallow copy gives b a separate outer list. Appending to b then leaves a unchanged.',
    source: collections,
  },
  {
    id: 'debug-even',
    objective_id: 'debugging',
    prompt:
      'For n = 4, the regression case expects is_even = True. Select the faulty line and its replacement.',
    activity: {
      kind: 'debug',
      lines: ['n = 4', 'is_even = n % 2 == 1'],
      repairs: ['is_even = n % 2 == 0', 'is_even = n // 2 == 0', 'is_even = n > 4'],
    },
    choices: [],
    answer: 0,
    solution: { line: 1, repair: 0 },
    explanation: 'An even integer has remainder zero after division by two.',
    source: python,
  },
  {
    id: 'debug-index',
    objective_id: 'debugging',
    prompt: 'The regression case expects first = 10. Select the faulty line and its replacement.',
    activity: {
      kind: 'debug',
      lines: ['items = [10, 20, 30]', 'first = items[1]'],
      repairs: ['first = items[0]', 'first = items[-1]', 'first = len(items)'],
    },
    choices: [],
    answer: 0,
    solution: { line: 1, repair: 0 },
    explanation: 'Python lists use zero-based indexing; items[0] is the first element.',
    source: collections,
  },
  {
    id: 'debug-append',
    objective_id: 'debugging',
    prompt:
      'The regression case expects values = [1, 2], rather than None. Select the faulty line and its replacement.',
    activity: {
      kind: 'debug',
      lines: ['values = [1]', 'values = values.append(2)'],
      repairs: ['values.append(2)', 'values.extend(2)', 'values = values.pop()'],
    },
    choices: [],
    answer: 0,
    solution: { line: 1, repair: 0 },
    explanation:
      'append mutates the list and returns None. Keep the list reference by calling append without assignment.',
    source: collections,
  },
  {
    id: 'debug-threshold',
    objective_id: 'debugging',
    prompt:
      'A passing score is 50 or higher. For score = 50, passed must be True. Select the faulty line and its replacement.',
    activity: {
      kind: 'debug',
      lines: ['score = 50', 'passed = score > 50'],
      repairs: ['passed = score >= 50', 'passed = score < 50', 'passed = score != 50'],
    },
    choices: [],
    answer: 0,
    solution: { line: 1, repair: 0 },
    explanation: 'The boundary value is included, so the comparison must be greater than or equal to 50.',
    source: python,
  },
  {
    id: 'debug-product',
    objective_id: 'debugging',
    prompt: 'The regression case expects product = 6. Select the faulty line and its replacement.',
    activity: {
      kind: 'debug',
      lines: ['product = 0', 'for n in [2, 3]:', '    product *= n'],
      repairs: ['product = 1', 'product = 2', 'product = -1'],
    },
    choices: [],
    answer: 0,
    solution: { line: 0, repair: 0 },
    explanation: 'One is the multiplicative identity. Starting at zero makes every product zero.',
    source: python,
  },
];

const students = {
  columns: ['name', 'score', 'team'],
  rows: [
    ['Ada', '8', 'red'],
    ['Bo', '5', 'blue'],
    ['Cy', '8', 'blue'],
    ['Dee', '3', 'red'],
  ],
};
const sqlCases = [
  [
    'filter',
    'SELECT name FROM learners WHERE score > 5 ORDER BY name;',
    'Ada, Cy',
    ['Ada, Cy', 'Ada, Bo, Cy', 'Bo, Dee'],
    'Only Ada and Cy have scores greater than 5; ordering by name puts Ada first.',
  ],
  [
    'count',
    "SELECT COUNT(*) FROM learners WHERE team = 'blue';",
    '2',
    ['2', '1', '4'],
    'Bo and Cy belong to the blue team, so COUNT(*) is 2.',
  ],
  [
    'distinct',
    'SELECT DISTINCT score FROM learners ORDER BY score;',
    '3, 5, 8',
    ['3, 5, 8', '8, 5, 8, 3', '5, 8'],
    'DISTINCT removes the duplicate 8, then ORDER BY sorts ascending.',
  ],
  [
    'sum',
    "SELECT SUM(score) FROM learners WHERE team = 'red';",
    '11',
    ['11', '16', '24'],
    'The red-team scores are 8 and 3; their sum is 11.',
  ],
  [
    'and',
    "SELECT name FROM learners WHERE score >= 5 AND team = 'blue' ORDER BY name;",
    'Bo, Cy',
    ['Bo, Cy', 'Ada, Bo, Cy', 'Cy'],
    'Bo and Cy satisfy both conditions.',
  ],
  [
    'limit',
    'SELECT name FROM learners ORDER BY score DESC, name ASC LIMIT 1;',
    'Ada',
    ['Ada', 'Cy', 'Dee'],
    'Ada and Cy tie on the highest score. The secondary alphabetical order chooses Ada.',
  ],
  [
    'average',
    'SELECT AVG(score) FROM learners;',
    '6',
    ['6', '8', '5'],
    'The four scores sum to 24 and 24 / 4 is 6. Numeric display formatting does not change that value.',
  ],
] as const;
export const SQL_QUESTIONS: ReviewedQuestion[] = sqlCases.map(([id, query, , choices, explanation]) => ({
  id: `sql-${id}`,
  objective_id: 'sql.query-results',
  prompt: 'Table: learners. Which result does this fixed PostgreSQL query return?',
  choices: [...choices],
  answer: 0,
  explanation,
  source: ['count', 'sum', 'average'].includes(id) ? aggregateSource : sqlSource,
  activity: { kind: 'sql', ...students, query },
}));

export function shortestPath(
  nodes: readonly string[],
  edges: readonly (readonly [string, string])[],
  start: string,
  goal: string,
): string[] {
  if (!nodes.includes(start) || !nodes.includes(goal)) return [];
  const queue: string[][] = [[start]];
  const seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift()!;
    const last = path.at(-1)!;
    if (last === goal) return path;
    for (const [a, b] of edges) {
      const next = a === last ? b : b === last ? a : undefined;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return [];
}
const graphCases: Array<{ nodes: string[]; edges: [string, string][]; start: string; goal: string }> = [
  {
    nodes: ['A', 'B', 'C', 'D'],
    edges: [
      ['A', 'B'],
      ['B', 'D'],
      ['A', 'C'],
      ['C', 'D'],
    ],
    start: 'A',
    goal: 'D',
  },
  {
    nodes: ['A', 'B', 'C', 'D'],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['A', 'D'],
    ],
    start: 'A',
    goal: 'D',
  },
  {
    nodes: ['A', 'B', 'C', 'D'],
    edges: [
      ['A', 'B'],
      ['C', 'D'],
    ],
    start: 'A',
    goal: 'D',
  },
  {
    nodes: ['A', 'B', 'C', 'D', 'E'],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'E'],
      ['A', 'D'],
      ['D', 'E'],
    ],
    start: 'A',
    goal: 'E',
  },
  {
    nodes: ['A', 'B', 'C', 'D', 'E'],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['D', 'E'],
      ['B', 'E'],
    ],
    start: 'E',
    goal: 'A',
  },
  {
    nodes: ['A', 'B', 'C', 'D', 'E', 'F'],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'F'],
      ['A', 'D'],
      ['D', 'E'],
      ['E', 'F'],
    ],
    start: 'A',
    goal: 'F',
  },
  {
    nodes: ['A', 'B', 'C'],
    edges: [
      ['A', 'B'],
      ['B', 'C'],
    ],
    start: 'B',
    goal: 'B',
  },
];
export const GRAPH_QUESTIONS: ReviewedQuestion[] = graphCases.map((graph, index) => {
  const route = shortestPath(graph.nodes, graph.edges, graph.start, graph.goal);
  return {
    id: `graph-${index + 1}`,
    objective_id: 'graphs.shortest-path',
    prompt: `Find a shortest path from ${graph.start} to ${graph.goal}. Edges are undirected and unweighted. Any shortest route is accepted; submit no path if the goal is unreachable.`,
    choices: [],
    answer: 0,
    explanation: route.length
      ? `A shortest route is ${route.join(' → ')} (${route.length - 1} edges). Equal-length alternatives are valid.`
      : 'The start and goal lie in different connected components, so no route exists.',
    source: graphSource,
    activity: { kind: 'graph', ...graph },
    solution: { node_ids: route },
  };
});

const proofCases = [
  {
    claim: 'The sum of two even integers is even.',
    steps: [
      'Let a = 2m for an integer m.',
      'Let b = 2n for an integer n.',
      'Then a + b = 2(m + n).',
      'Since m + n is an integer, a + b is even.',
    ],
  },
  {
    claim: 'The sum of two odd integers is even.',
    steps: [
      'Let a = 2m + 1 for an integer m.',
      'Let b = 2n + 1 for an integer n.',
      'Then a + b = 2(m + n + 1).',
      'Since m + n + 1 is an integer, a + b is even.',
    ],
  },
  {
    claim: 'The product of an even integer and any integer is even.',
    steps: [
      'Let a = 2m for an integer m.',
      'Let b be any integer.',
      'Then ab = 2(mb).',
      'Since mb is an integer, ab is even.',
    ],
  },
  {
    claim: 'The sum of an even integer and an odd integer is odd.',
    steps: [
      'Let a = 2m for an integer m.',
      'Let b = 2n + 1 for an integer n.',
      'Then a + b = 2(m + n) + 1.',
      'Since m + n is an integer, a + b is odd.',
    ],
  },
  {
    claim: 'The difference of two even integers is even.',
    steps: [
      'Let a = 2m for an integer m.',
      'Let b = 2n for an integer n.',
      'Then a - b = 2(m - n).',
      'Since m - n is an integer, a - b is even.',
    ],
  },
  {
    claim: 'The product of two odd integers is odd.',
    steps: [
      'Let a = 2m + 1 for an integer m.',
      'Let b = 2n + 1 for an integer n.',
      'Then ab = 2(2mn + m + n) + 1.',
      'Since 2mn + m + n is an integer, ab is odd.',
    ],
  },
  {
    claim: 'The sum of two multiples of three is a multiple of three.',
    steps: [
      'Let a = 3m for an integer m.',
      'Let b = 3n for an integer n.',
      'Then a + b = 3(m + n).',
      'Since m + n is an integer, a + b is a multiple of three.',
    ],
  },
];
export const PROOF_QUESTIONS: ReviewedQuestion[] = proofCases.map((proof, index) => ({
  id: `proof-${index + 1}`,
  objective_id: 'proofs.dependencies',
  prompt: `Prove: ${proof.claim} Arrange every step after the facts it uses. The two initial assumptions are independent.`,
  choices: [],
  answer: 0,
  explanation:
    'Both integer assumptions must precede substitution; substitution must precede the conclusion. The assumptions can be interchanged.',
  source: proofSource,
  activity: { kind: 'proof', steps: proof.steps.map((text, i) => ({ id: `s${i + 1}`, text })) },
  solution: {
    step_ids: ['s1', 's2', 's3', 's4'],
    dependencies: [
      ['s1', 's3'],
      ['s2', 's3'],
      ['s3', 's4'],
    ],
  },
}));

const dataCases = [
  {
    id: 'max',
    columns: ['Day', 'Books read'],
    rows: [
      ['Mon', '4'],
      ['Tue', '7'],
      ['Wed', '5'],
    ],
    units: 'books per day',
    prompt: 'Which day has the largest recorded count?',
    choices: ['Tuesday', 'Monday', 'Wednesday'],
    explanation: 'Tuesday records 7 books, larger than 4 or 5.',
  },
  {
    id: 'change',
    columns: ['Week', 'Practice minutes'],
    rows: [
      ['1', '30'],
      ['2', '45'],
      ['3', '40'],
    ],
    units: 'minutes per week',
    prompt: 'How much did practice increase from week 1 to week 2?',
    choices: ['15 minutes', '50 minutes', '5 minutes'],
    explanation: '45 - 30 = 15 minutes. An absolute change uses the same unit as the values.',
  },
  {
    id: 'mean',
    columns: ['Group', 'Tasks completed'],
    rows: [
      ['A', '2'],
      ['B', '4'],
      ['C', '6'],
    ],
    units: 'tasks per group',
    prompt: 'What is the arithmetic mean of these three counts?',
    choices: ['4 tasks', '6 tasks', '12 tasks'],
    explanation: '(2 + 4 + 6) / 3 = 4 tasks.',
  },
  {
    id: 'causation',
    columns: ['Day', 'Practice minutes', 'Score out of 10'],
    rows: [
      ['1', '10', '5'],
      ['2', '20', '6'],
      ['3', '30', '8'],
    ],
    units: 'minutes and score points',
    prompt: 'Which claim is supported by these three observations alone?',
    choices: [
      'Both recorded measures rise across these days.',
      'More practice causes every learner to score higher.',
      'A score of 10 is guaranteed after 40 minutes.',
    ],
    explanation:
      'The table shows an association in three observations. It cannot establish universal causation or guarantee an extrapolated score.',
  },
  {
    id: 'total',
    columns: ['Travel mode', 'Count'],
    rows: [
      ['Walk', '6'],
      ['Cycle', '4'],
      ['Bus', '10'],
    ],
    units: 'learners',
    prompt: 'Each learner chose exactly one travel mode. How many learners are recorded in total?',
    choices: ['20 learners', '10 learners', '24 learners'],
    explanation: 'The mutually exclusive categories sum to 6 + 4 + 10 = 20 learners.',
  },
  {
    id: 'percent',
    columns: ['Outcome', 'Count'],
    rows: [
      ['Complete', '15'],
      ['Incomplete', '5'],
    ],
    units: 'sessions',
    prompt: 'What percentage of these sessions were complete?',
    choices: ['75%', '15%', '25%'],
    explanation: '15 out of 20 sessions is 15/20 = 0.75, or 75%.',
  },
  {
    id: 'trend',
    columns: ['Month', 'Active days'],
    rows: [
      ['Jan', '12'],
      ['Feb', '9'],
      ['Mar', '15'],
    ],
    units: 'active days per month',
    prompt: 'Which description matches every recorded change?',
    choices: ['The count falls, then rises.', 'The count rises every month.', 'The count never changes.'],
    explanation:
      '12 to 9 is a decrease; 9 to 15 is an increase. Three months do not establish a longer-term trend.',
  },
];
export const DATA_QUESTIONS: ReviewedQuestion[] = dataCases.map(
  ({ id, columns, rows, units, prompt, choices, explanation }) => ({
    id: `data-${id}`,
    objective_id: 'data.evidence',
    prompt,
    choices,
    answer: 0,
    explanation,
    source: id === 'causation' ? scatterSource : dataSource,
    activity: { kind: 'data', columns, rows, units },
  }),
);

export const EXPANDED_QUESTIONS: Readonly<Record<string, readonly ReviewedQuestion[]>> = {
  DebuggingDetective: DEBUG_QUESTIONS,
  SQLDetective: SQL_QUESTIONS,
  GraphPath: GRAPH_QUESTIONS,
  ProofBuilder: PROOF_QUESTIONS,
  DataDetective: DATA_QUESTIONS,
};
