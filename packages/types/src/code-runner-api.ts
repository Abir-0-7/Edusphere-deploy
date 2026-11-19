import { z } from 'zod';

export const RunnerProblemIdSchema = z.enum([
  'sum-pairs',
  'reverse-words',
  'python-average',
  'python-passing-count',
  'paid-total',
  'tensor-value-count',
  'broadcast-value-count',
  'parameter-update',
]);
export type RunnerProblemId = z.infer<typeof RunnerProblemIdSchema>;

export const CodeChallengeRequestSchema = z.strictObject({
  problemId: RunnerProblemIdSchema,
  language: z.enum(['python', 'javascript']),
  source: z.string().min(1).max(20_000),
  courseContext: z
    .strictObject({
      enrollmentId: z.string().uuid(),
      labId: z.string().min(1).max(120),
      taskId: z.string().min(1).max(120),
    })
    .optional(),
});
export type CodeChallengeRequest = z.infer<typeof CodeChallengeRequestSchema>;

export const CodeChallengeGradeSchema = z.strictObject({
  problemId: RunnerProblemIdSchema,
  passed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  results: z.array(z.strictObject({ passed: z.boolean(), output: z.string(), error: z.string() })),
  courseReceipt: z.string().max(256).nullable().optional(),
});
export type CodeChallengeGrade = z.infer<typeof CodeChallengeGradeSchema>;
