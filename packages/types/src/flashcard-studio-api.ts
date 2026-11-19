import { z } from 'zod';

export const MAX_STUDIO_CHAPTERS = 12;
export const MAX_STUDIO_CARDS = 20;
export const MAX_STUDIO_TOPIC_LENGTH = 120;
export const MAX_STUDIO_DECK_NAME_LENGTH = 80;

const IdSchema = z.uuid();
const CountSchema = z.number().int().nonnegative();
const uniqueIds = (maximum: number) =>
  z.array(IdSchema).min(1).max(maximum).refine((ids) => new Set(ids).size === ids.length, {
    message: 'IDs must be unique.',
  });

export const StudioLanguageSchema = z.enum(['en', 'bn']);
export const StudioDifficultySchema = z.enum(['basic', 'intermediate', 'advanced']);
export const StudioGenerationSettingsSchema = z.strictObject({
  chapter_ids: uniqueIds(MAX_STUDIO_CHAPTERS),
  topic: z.string().trim().min(1).max(MAX_STUDIO_TOPIC_LENGTH).nullish(),
  language: StudioLanguageSchema,
  difficulty: StudioDifficultySchema,
  count: z.number().int().min(1).max(MAX_STUDIO_CARDS),
});
export type StudioGenerationSettings = z.infer<typeof StudioGenerationSettingsSchema>;

export const StudioDraftStartSchema = z.strictObject({ job_id: IdSchema, draft_id: IdSchema });

export const StudioDraftCardSchema = z.strictObject({
  id: IdSchema,
  chapter_id: IdSchema,
  source_chunk_id: IdSchema,
  source_quote: z.string().trim().min(1).max(500),
  front: z.string().trim().min(1).max(300),
  back: z.string().trim().min(1).max(600),
  page: z.number().int().positive().nullable(),
});

export const StudioDraftReplacementSchema = z.strictObject({
  draft_card_id: IdSchema,
  card_id: IdSchema,
});
export const StudioDraftMergeRequestSchema = z.strictObject({
  card_ids: uniqueIds(MAX_STUDIO_CARDS),
  deck_name: z.string().trim().min(1).max(MAX_STUDIO_DECK_NAME_LENGTH).nullish(),
  replacements: z.array(StudioDraftReplacementSchema).max(MAX_STUDIO_CARDS).default([]),
}).refine((request) => {
  const candidateIds = request.replacements.map((replacement) => replacement.draft_card_id);
  const targetIds = request.replacements.map((replacement) => replacement.card_id);
  return new Set(candidateIds).size === candidateIds.length
    && new Set(targetIds).size === targetIds.length
    && candidateIds.every((id) => request.card_ids.includes(id));
});
export type StudioDraftMergeRequest = z.infer<typeof StudioDraftMergeRequestSchema>;

export const StudioDraftMergeResponseSchema = z.strictObject({
  deck_id: IdSchema,
  added_count: CountSchema,
  updated_count: CountSchema.default(0),
});
export type StudioDraftMergeResult = z.infer<typeof StudioDraftMergeResponseSchema>;

export const StudioDraftResponseSchema = z.strictObject({
  id: IdSchema,
  source_revision: z.string().regex(/^[a-f0-9]{64}$/),
  settings: StudioGenerationSettingsSchema,
  cards: z.array(StudioDraftCardSchema).min(1).max(MAX_STUDIO_CARDS),
  merge_result: StudioDraftMergeResponseSchema.nullable(),
}).refine(({ cards, settings }) => (
  cards.length <= settings.count &&
  new Set(cards.map(({ id }) => id)).size === cards.length &&
  cards.every(({ chapter_id }) => settings.chapter_ids.includes(chapter_id))
), { message: 'Draft cards do not match the generation settings.' });
export type StudioDraft = z.infer<typeof StudioDraftResponseSchema>;

export const StudioDeckSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(MAX_STUDIO_DECK_NAME_LENGTH),
  is_default: z.boolean(),
  card_count: CountSchema,
});
export const StudioDeckListSchema = z.array(StudioDeckSchema);
export type StudioDeck = z.infer<typeof StudioDeckSchema>;

export const QuizStartRequestSchema = z.strictObject({
  deck_id: IdSchema,
  count: z.number().int().min(1).max(20).default(10),
});
export const QuizChoiceSchema = z.strictObject({ id: IdSchema, text: z.string().min(1).max(600) });
export const QuizQuestionSchema = z.strictObject({
  id: IdSchema,
  prompt: z.string().min(1).max(300),
  choices: z.array(QuizChoiceSchema).min(2).max(4),
}).refine(({ choices }) => new Set(choices.map(({ id }) => id)).size === choices.length, {
  message: 'Quiz choices must have unique IDs.',
});
export const QuizSessionSchema = z.strictObject({
  id: IdSchema,
  document_id: IdSchema,
  deck_id: IdSchema,
  questions: z.array(QuizQuestionSchema).min(1).max(20),
}).refine(({ questions }) => new Set(questions.map(({ id }) => id)).size === questions.length, {
  message: 'Quiz questions must have unique IDs.',
});
export const QuizAnswerSchema = z.strictObject({ question_id: IdSchema, choice_id: IdSchema });
export const QuizGradeRequestSchema = z.strictObject({ answers: z.array(QuizAnswerSchema).max(20) }).refine(
  ({ answers }) => new Set(answers.map(({ question_id }) => question_id)).size === answers.length,
  { message: 'Each quiz question may be answered once.' },
);
export const QuizFeedbackSchema = z.strictObject({
  question_id: IdSchema,
  answered: z.boolean(),
  correct: z.boolean(),
  source_quote: z.string().min(1).max(1600),
  page: z.number().int().positive().nullable(),
});
export const QuizGradeResultSchema = z.strictObject({
  session_id: IdSchema,
  answered: z.number().int().min(0).max(20),
  correct: z.number().int().min(0).max(20),
  total: z.number().int().min(1).max(20),
  percent: z.number().int().min(0).max(100),
  feedback: z.array(QuizFeedbackSchema).min(1).max(20),
});
export type QuizSession = z.infer<typeof QuizSessionSchema>;
export type QuizStartRequest = z.infer<typeof QuizStartRequestSchema>;
export type QuizGradeRequest = z.infer<typeof QuizGradeRequestSchema>;
export type QuizGradeResult = z.infer<typeof QuizGradeResultSchema>;
