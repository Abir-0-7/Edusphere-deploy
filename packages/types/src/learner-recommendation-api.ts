import { z } from 'zod';

export const RecommendationRequestSchema = z.strictObject({
  available_minutes: z.number().int().min(1).max(10080).nullable().optional(),
});
export type RecommendationRequest = z.infer<typeof RecommendationRequestSchema>;

export const RecommendationActivitySchema = z.strictObject({
  kind: z.enum(['set_goal', 'review', 'lesson', 'resume', 'remediate', 'transfer']),
  title: z.string(),
  reason: z.string(),
  href: z.string(),
  minutes: z.number().int().nonnegative(),
  objective_id: z.string().nullable(),
});
export type RecommendationActivity = z.infer<typeof RecommendationActivitySchema>;

export const RecommendationBlockedSchema = z.strictObject({
  course_slug: z.string(),
  reason: z.string(),
});

export const ObjectiveRecommendationEvidenceSchema = z.strictObject({
  objective_id: z.string(),
  title: z.string(),
  state: z.enum(['unknown', 'developing', 'needs_practice', 'demonstrated']),
  evidence: z.enum(['none', 'diagnostic', 'committed_attempt', 'independent_checkpoint']),
  starting_signal: z.enum(['unknown', 'needs_practice', 'developing']).default('unknown'),
  release_id: z.string().uuid(),
});

export const RecommendationResponseSchema = z.strictObject({
  policy_version: z.string(),
  track_id: z.enum(['analyst', 'developer', 'programming-exam']).nullable(),
  plan_revision: z.number().int().nonnegative(),
  available_minutes: z.number().int().nonnegative(),
  due_reviews: z.number().int().nonnegative(),
  mastery: z.array(ObjectiveRecommendationEvidenceSchema),
  next_action: RecommendationActivitySchema.nullable(),
  blocked: z.array(RecommendationBlockedSchema),
});
export type RecommendationResponse = z.infer<typeof RecommendationResponseSchema>;
