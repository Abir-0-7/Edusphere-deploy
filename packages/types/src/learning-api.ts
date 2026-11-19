import { z } from 'zod';

/** Canonical snake_case JSON contracts for the existing FastAPI learning routes.
 * Older camelCase schemas remain available for existing internal consumers.
 */
export const JobResponseSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'cancelled']),
  attempts: z.number().int().nonnegative(),
  error_reason: z.string().nullable().optional(),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type JobResponse = z.infer<typeof JobResponseSchema>;

export const JobCancelResponseSchema = z.object({ id: z.string().uuid(), status: z.literal('cancelled') });
export type JobCancelResponse = z.infer<typeof JobCancelResponseSchema>;

export const ChapterResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  ordinal: z.number().int().nonnegative(),
  start_page: z.number().int().positive().nullable(),
  end_page: z.number().int().positive().nullable(),
});
export const ChapterListResponseSchema = z.array(ChapterResponseSchema);
export type ChapterResponse = z.infer<typeof ChapterResponseSchema>;

export const FlashcardResponseSchema = z.object({
  id: z.string().uuid(),
  front: z.string(),
  back: z.string(),
  ease_factor: z.number().positive(),
  interval_days: z.number().int().nonnegative(),
  repetitions: z.number().int().nonnegative(),
  due_date: z.string().date(),
  document_id: z.string().uuid().nullable().optional(),
  chapter_id: z.string().uuid().nullable().optional(),
  source_chunk_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  status: z.enum(['active', 'retired']).optional(),
  needs_review: z.boolean().optional(),
});
export const FlashcardListResponseSchema = z.array(FlashcardResponseSchema);
export const FlashcardExplanationResponseSchema = z.strictObject({
  card_id: z.uuid(),
  available: z.boolean(),
  explanation: z.string().trim().min(1).max(1200),
  source_quote: z.string().trim().min(1).max(1600),
  source_excerpt: z.string().trim().min(1).max(1600).nullable(),
  page: z.number().int().positive().nullable(),
});
export type FlashcardExplanationResponse = z.infer<typeof FlashcardExplanationResponseSchema>;

export const FlashcardEditRequestSchema = z.strictObject({
  front: z.string().trim().min(1).max(300).optional(),
  back: z.string().trim().min(1).max(600).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).refine((tags) => new Set(tags).size === tags.length).optional(),
}).refine((value) => value.front !== undefined || value.back !== undefined || value.tags !== undefined);
export const FlashcardDeleteResponseSchema = z.strictObject({ card_id: z.uuid(), deleted: z.literal(true) });
export const FlashcardReportRequestSchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export const FlashcardReportResponseSchema = z.strictObject({
  card_id: z.uuid(),
  report_id: z.uuid(),
  status: z.literal('received'),
});

export type FlashcardResponse = z.infer<typeof FlashcardResponseSchema>;

export const FlashcardGenerationResponseSchema = z.object({ job_id: z.string().uuid() });

export const ReviewRequestSchema = z.object({
  grade: z.number().int().min(0).max(5),
  review_id: z.string().uuid().nullable().optional(),
});
/** A review returns scheduling only, never a complete flashcard. */
export const ReviewResultSchema = z.object({
  id: z.string().uuid(),
  ease_factor: z.number().positive(),
  interval_days: z.number().int().nonnegative(),
  repetitions: z.number().int().nonnegative(),
  due_date: z.string().date(),
  replayed: z.boolean().nullable().optional(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const ChatRequestSchema = z.object({ question: z.string().trim().min(1).max(4000) });
export const ChatReplySchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({
      chunk_id: z.string().uuid(),
      page: z.number().int().positive().nullable(),
      quote: z.string(),
    }),
  ),
});
export type ChatReply = z.infer<typeof ChatReplySchema>;
