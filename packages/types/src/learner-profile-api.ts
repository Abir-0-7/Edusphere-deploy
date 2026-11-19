import { z } from 'zod';

/** Explicit learner preferences; self-report and diagnostic signals never grant mastery. */
export const LEARNER_DIAGNOSTIC_VERSION = 'python-foundations-v1' as const;
const DiagnosticVersion = z.literal(LEARNER_DIAGNOSTIC_VERSION);
const DiagnosticSkill = z.enum(['python-expressions', 'python-loops', 'python-functions']);
const Timestamp = z.iso.datetime({ offset: true });

export const LearnerProfileInputSchema = z.strictObject({
  goal_kind: z.enum(['career', 'academic']),
  goal: z.string().trim().min(1).max(200),
  familiarity: z.enum(['new', 'some', 'experienced', 'unsure']),
  weekly_minutes: z.number().int().min(15).max(10080),
  deadline: z.iso.date().nullable(),
  language: z.enum(['en', 'bn']),
  role_variant: z.enum(['auto', 'analyst', 'developer']).default('auto'),
  explanation_depth: z.enum(['guided', 'standard', 'concise']).default('standard'),
  pace: z.enum(['short_sessions', 'standard']).default('standard'),
  accessibility: z.strictObject({
    reduced_motion: z.boolean(),
    larger_text: z.boolean(),
    text_alternative: z.boolean(),
  }),
});
export type LearnerProfileInput = z.infer<typeof LearnerProfileInputSchema>;

export const LearnerDiagnosticSummarySchema = z.strictObject({
  version: DiagnosticVersion,
  status: z.enum(['not_started', 'skipped', 'completed']),
  skills: z
    .array(
      z.strictObject({
        skill_id: DiagnosticSkill,
        state: z.enum(['unknown', 'needs_practice', 'developing']),
      }),
    )
    .max(3),
  completed_at: Timestamp.nullable(),
});
export type LearnerDiagnosticSummary = z.infer<typeof LearnerDiagnosticSummarySchema>;

export const LearnerProfileSchema = LearnerProfileInputSchema.extend({
  diagnostic: LearnerDiagnosticSummarySchema,
  updated_at: Timestamp,
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

export const LearnerProfileResponseSchema = z.strictObject({
  profile: LearnerProfileSchema.nullable(),
});
export type LearnerProfileResponse = z.infer<typeof LearnerProfileResponseSchema>;

/** Public diagnostic questions contain choices only; answer keys stay on the server. */
export const LearnerDiagnosticDefinitionSchema = z.strictObject({
  version: DiagnosticVersion,
  title: z.string(),
  description: z.string(),
  questions: z
    .array(
      z.strictObject({
        id: z.string(),
        skill_id: DiagnosticSkill,
        prompt: z.string(),
        choices: z.array(z.strictObject({ id: z.string(), label: z.string() })).length(3),
      }),
    )
    .length(3),
});
export type LearnerDiagnosticDefinition = z.infer<typeof LearnerDiagnosticDefinitionSchema>;

export const LearnerDiagnosticRequestSchema = z
  .strictObject({
    version: DiagnosticVersion,
    action: z.enum(['complete', 'skip']),
    answers: z
      .array(
        z.strictObject({
          question_id: z.string().min(1).max(64),
          choice_id: z.string().min(1).max(64).nullable(),
        }),
      )
      .max(3),
  })
  .superRefine((request, context) => {
    if (new Set(request.answers.map((answer) => answer.question_id)).size !== request.answers.length) {
      context.addIssue({ code: 'custom', path: ['answers'], message: 'Question IDs must be unique.' });
    }
    if (request.action === 'skip' && request.answers.length > 0) {
      context.addIssue({ code: 'custom', path: ['answers'], message: 'Skipping requires no answers.' });
    }
    if (request.action === 'complete' && !request.answers.some((answer) => answer.choice_id !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['answers'],
        message: 'Answer at least one question or skip.',
      });
    }
  });
export type LearnerDiagnosticRequest = z.infer<typeof LearnerDiagnosticRequestSchema>;
