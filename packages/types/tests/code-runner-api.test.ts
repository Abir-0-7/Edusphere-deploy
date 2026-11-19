import { describe, expect, it } from 'vitest';
import { CodeChallengeGradeSchema, CodeChallengeRequestSchema } from '../src/code-runner-api';

describe('course code runner contracts', () => {
  it('accepts only curated problem ids and bounded source', () => {
    expect(
      CodeChallengeRequestSchema.safeParse({
        problemId: 'tensor-value-count',
        language: 'python',
        source: 'print(12)',
        courseContext: {
          enrollmentId: 'fb5fbd80-a870-4e2c-a9a5-9ae2183dcbf2',
          labId: 'pytorch-fundamentals-code-lab',
          taskId: 'pytorch-code-count',
        },
      }).success,
    ).toBe(true);
    expect(
      CodeChallengeRequestSchema.safeParse({ problemId: 'arbitrary', language: 'python', source: 'x' })
        .success,
    ).toBe(false);
    expect(
      CodeChallengeRequestSchema.safeParse({
        problemId: 'sum-pairs',
        language: 'python',
        source: 'x',
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('parses bounded test results and a short-lived course receipt', () => {
    expect(
      CodeChallengeGradeSchema.safeParse({
        problemId: 'sum-pairs',
        passed: 2,
        total: 2,
        results: [
          { passed: true, output: '5', error: '' },
          { passed: true, output: '5', error: '' },
        ],
        courseReceipt: `${Date.now()}.hash.signature`,
      }).success,
    ).toBe(true);
  });
});
