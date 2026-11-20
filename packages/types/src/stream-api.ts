import { z } from 'zod';

export const SummaryRequestSchema = z.object({ level: z.enum(['standard', 'eli5', 'deep_dive']) });
export const SummaryResponseSchema = z.object({
  id: z.string().uuid(),
  chapter_id: z.string().uuid(),
  level: SummaryRequestSchema.shape.level,
  content: z.string(),
  model: z.string().nullable(),
});
export const SummaryEventSchema = z.union([
  z.strictObject({ token: z.string() }),
  z.strictObject({ done: z.literal(true), summary_id: z.string().uuid() }),
  z.strictObject({ error: z.string() }),
]);
export const TtsRequestSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  voice: z.string().trim().min(1).max(100).nullable().optional(),
});
export const WordTimingSchema = z
  .object({
    text: z.string(),
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().nonnegative(),
  })
  .refine((word) => word.end_ms >= word.start_ms, 'end_ms must not precede start_ms');
export type WordTiming = z.infer<typeof WordTimingSchema>;
export const AudioBase64Schema = z
  .string()
  .min(4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const TtsResponseSchema = z.object({
  audio_b64: AudioBase64Schema,
  content_type: z.literal('audio/mpeg'),
  words: z.array(WordTimingSchema),
});
export const TtsDoneEventSchema = z.strictObject({});
export const TtsErrorEventSchema = z.object({ message: z.string() });
