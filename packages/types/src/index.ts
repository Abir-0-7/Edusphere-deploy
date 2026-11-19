import { z } from 'zod';

/** Shared error shape — single source of truth for all API errors. */
export const ErrorSchema = z.object({
  code: z.enum(['invalid_input', 'unauthorized', 'not_found', 'rate_limited', 'file_too_large', 'conflict', 'internal']),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ErrorSchema>;
export const ErrorEnvelopeSchema = z.object({ error: ErrorSchema });
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const JobStatusSchema = z.enum(['pending', 'running', 'done', 'failed']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const ParsePdfResponseSchema = z.object({
  job_id: z.string().uuid(),
  document_id: z.string().uuid(),
});
export type ParsePdfResponse = z.infer<typeof ParsePdfResponseSchema>;

export const SummaryLevelSchema = z.enum(['standard', 'eli5', 'deep_dive']);
export type SummaryLevel = z.infer<typeof SummaryLevelSchema>;

export const ChapterSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  ordinal: z.number().int(),
  startPage: z.number().int().nullable(),
  endPage: z.number().int().nullable(),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const FlashcardSchema = z.object({
  id: z.string().uuid(),
  front: z.string(),
  back: z.string(),
  sourceChunkId: z.string().uuid().nullable(),
  easeFactor: z.number(),
  intervalDays: z.number().int(),
  repetitions: z.number().int(),
  dueDate: z.string().date(),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;

/** SM-2 review grade (0–5). */
export const ReviewGradeSchema = z.number().int().min(0).max(5);

export const FocusKindSchema = z.enum(['pomodoro', 'desk', 'ultradian']);

export const ChatCitationSchema = z.object({
  chunkId: z.string().uuid(),
  page: z.number().int().nullable(),
  quote: z.string(),
});
export type ChatCitation = z.infer<typeof ChatCitationSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(ChatCitationSchema).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const GuildCreateSchema = z.object({
  name: z.string().trim().min(2).max(64),
  weeklyGoalMinutes: z.number().int().min(30).max(10080).default(300),
});
export const GuildJoinSchema = z.object({ inviteCode: z.string().trim().min(8).max(16).toUpperCase() });
export const GuildGoalSchema = z.object({ weeklyGoalMinutes: z.number().int().min(30).max(10080) });
export const GuildSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  inviteCode: z.string(),
  weeklyGoalMinutes: z.number().int(),
  memberCount: z.number().int().nonnegative(),
  weeklyMultiplier: z.number().min(1).max(1.25),
});
export type Guild = z.infer<typeof GuildSchema>;

export * from './game-api';
export * from './cyberverse-api';
export * from './course-api';
export * from './code-runner-api';
export * from './learner-profile-api';
export * from './learner-recommendation-api';
export * from './track-plan-api';

export * from './learning-api';
export * from './flashcard-studio-api';
export * from './concept-graph-api';
