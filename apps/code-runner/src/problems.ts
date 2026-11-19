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
  {
    id: 'python-average',
    title: 'Average a list',
    statement: 'Read one line of non-empty integers and print their arithmetic mean.',
    languageIds: { python: 71, javascript: 63 },
    tests: [
      { input: '10 20 30\n', expectedOutput: '20.0' },
      { input: '3 4\n', expectedOutput: '3.5' },
    ],
  },
  {
    id: 'python-passing-count',
    title: 'Count passing scores',
    statement: 'Read one line of integer scores and print how many are at least 60.',
    languageIds: { python: 71, javascript: 63 },
    tests: [
      { input: '45 60 72 59\n', expectedOutput: '2' },
      { input: '0 100 100\n', expectedOutput: '2' },
    ],
  },
  {
    id: 'paid-total',
    title: 'Aggregate selected records',
    statement:
      'Read a record count followed by paid-flag and amount pairs; print the total amount for paid records.',
    languageIds: { python: 71, javascript: 63 },
    tests: [
      { input: '3\n1 7\n0 5\n1 4\n', expectedOutput: '11' },
      { input: '2\n0 8\n1 3\n', expectedOutput: '3' },
    ],
  },
  {
    id: 'tensor-value-count',
    title: 'Count tensor values',
    statement: 'Read row and column lengths and print the number of values in a two-dimensional tensor.',
    languageIds: { python: 71, javascript: 63 },
    tests: [
      { input: '4 3\n', expectedOutput: '12' },
      { input: '2 5\n', expectedOutput: '10' },
    ],
  },
  {
    id: 'broadcast-value-count',
    title: 'Trace a broadcast element count',
    statement:
      'Shapes (batch, 1) and (1, 3) broadcast to (batch, 3); read batch and print output element count.',
    languageIds: { python: 71, javascript: 63 },
    tests: [
      { input: '5\n', expectedOutput: '15' },
      { input: '8\n', expectedOutput: '24' },
    ],
  },
  {
    id: 'parameter-update',
    title: 'Apply one parameter update',
    statement: 'Read integer old value, rate and gradient; print old - rate * gradient.',
    languageIds: { python: 71, javascript: 63 },
    tests: [
      { input: '8 1 3\n', expectedOutput: '5' },
      { input: '15 2 4\n', expectedOutput: '7' },
    ],
  },
];

export function getProblem(id: string): Problem {
  const problem = PROBLEMS.find((candidate) => candidate.id === id);
  if (!problem) throw new Error('Unknown problem');
  return problem;
}
