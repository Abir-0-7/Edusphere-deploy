import type { Problem } from './types.js';

export const PROBLEMS: readonly Problem[] = [
  {
    id: 'sum-pairs',
    title: 'Sum pairs',
    statement: 'Read two integers and print their sum.',
    languageIds: { python: 71, javascript: 63 },
    tests: [
      { input: '2 3\n', expectedOutput: '5' },
      { input: '-4 9\n', expectedOutput: '5' },
    ],
  },
  {
    id: 'reverse-words',
    title: 'Reverse words',
    statement: 'Read a line and print its whitespace-separated words in reverse order.',
    languageIds: { python: 71, javascript: 63 },
    tests: [
      { input: 'study vault\n', expectedOutput: 'vault study' },
      { input: 'one two three\n', expectedOutput: 'three two one' },
    ],
  },
];

export function getProblem(id: string): Problem {
  const problem = PROBLEMS.find((candidate) => candidate.id === id);
  if (!problem) throw new Error('Unknown problem');
  return problem;
}
