import { z } from 'zod';

/** Wire contracts for focus, progress, plans and weekly advice. */
const FocusKind = z.enum(['pomodoro', 'desk', 'ultradian']);
const Timestamp = z.string().datetime({ offset: true });
const Count = z.number().int().nonnegative();
const Rate = z.number().min(0).max(1);

export const FocusStartRequestSchema = z.object({
  kind: FocusKind,
  planned_seconds: z.number().int().min(60).max(14400).nullable().optional(),
});
export const FocusSessionResponseSchema = z.object({
  id: z.string().uuid(),
  kind: FocusKind,
  planned_seconds: z.number().int().min(60).max(14400),
  actual_seconds: Count,
  status: z.enum(['running', 'completed', 'abandoned']),
  started_at: Timestamp,
  expected_end_at: Timestamp,
  ended_at: Timestamp.nullable(),
});
export type FocusSessionResponse = z.infer<typeof FocusSessionResponseSchema>;
export const CurrentFocusSessionResponseSchema = FocusSessionResponseSchema.nullable();
export const FocusCompletionResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['completed', 'abandoned']),
  actual_seconds: Count,
  tokens_awarded: Count,
  token_balance: Count,
  replayed: z.boolean(),
  kind: FocusKind.nullable().optional(),
  planned_seconds: z.number().int().min(60).max(14400).nullable().optional(),
  started_at: Timestamp.nullable().optional(),
  expected_end_at: Timestamp.nullable().optional(),
  ended_at: Timestamp.nullable().optional(),
});
export type FocusCompletionResponse = z.infer<typeof FocusCompletionResponseSchema>;
export const TokenBalanceResponseSchema = z.object({ balance: Count });
export const DashboardResponseSchema = z.object({
  focus_minutes_7d: Count,
  focus_seconds_per_day: z.record(z.string().date(), Count),
  reviews_7d: Count,
  due_flashcards: Count,
  token_balance: Count,
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;
export const ReadinessResponseSchema = z.object({
  score: z.number().int().min(0).max(100),
  coverage: Rate,
  retention: Rate,
  activity: Rate,
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
export const StudyPlanRequestSchema = z.object({
  exam_date: z.string().date(),
  minutes_per_day: z.number().int().min(15).max(480).default(60),
});
export const ExamPlanResponseSchema = z.object({
  exam_date: z.string().date(),
  days: z
    .array(
      z.object({
        date: z.string().date(),
        chapters: z.array(z.string()),
        minutes: z.number().int().min(15).max(480),
        focus: z.string(),
      }),
    )
    .min(1),
});
export type ExamPlanResponse = z.infer<typeof ExamPlanResponseSchema>;
export const SavedStudyPlanResponseSchema = z.object({
  exam_date: z.string().date(),
  plan: ExamPlanResponseSchema,
});
export const WeeklyAdviceResponseSchema = z.object({
  content: z.string(),
  model: z.string().nullable(),
  generated_at: Timestamp,
  cached: z.boolean(),
});
