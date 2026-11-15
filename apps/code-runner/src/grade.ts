import type { Grade, Language, Problem, RunResult } from './types.js';
import { Judge0Client } from './judge0.js';

const normalize = (value: string): string => value.trim().replace(/\r\n/g, '\n');

export async function gradeProblem(client: Judge0Client, problem: Problem, language: Language, source: string): Promise<Grade> {
  const results: Array<{ passed: boolean; output: string; error: string }> = [];
  for (const test of problem.tests) {
    const result: RunResult = await client.run(problem.languageIds[language], source, test.input, test.expectedOutput);
    const passed = result.statusId === 3 && normalize(result.stdout) === normalize(test.expectedOutput);
    results.push({ passed, output: result.stdout, error: [result.compileOutput, result.stderr, result.message].filter(Boolean).join('\n') });
  }
  return { problemId: problem.id, passed: results.filter((result) => result.passed).length, total: results.length, results };
}

export function sanitizeFeedback(source: string, error: string): string {
  const clean = (value: string): string => Array.from(value, (character) => character < ' ' || character === '\u007f' ? ' ' : character).join('').slice(0, 2_000);
  return `UNTRUSTED_CODE\n${clean(source).slice(0, 4_000)}\nEND_UNTRUSTED_CODE\nRUN_OUTPUT\n${clean(error)}\nEND_RUN_OUTPUT`;
}
