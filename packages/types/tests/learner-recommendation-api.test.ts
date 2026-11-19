import { describe, expect, it } from 'vitest';
import { RecommendationRequestSchema, RecommendationResponseSchema } from '../src/learner-recommendation-api';

const snapshot = {
  policy_version: 'career-next-action-v1',
  track_id: 'developer',
  plan_revision: 2,
  available_minutes: 20,
  due_reviews: 1,
  mastery: [
    {
      objective_id: 'py-values-objective',
      title: 'Trace values and expressions',
      state: 'unknown',
      evidence: 'none',
      starting_signal: 'unknown',
      release_id: '88ca9aad-2c93-4c75-81ce-7cb712862310',
    },
  ],
  next_action: {
    kind: 'review',
    title: 'Review due cards',
    reason: 'One scheduled review is due.',
    href: '/review',
    minutes: 5,
    objective_id: null,
  },
  blocked: [
    {
      course_slug: 'pytorch-fundamentals',
      reason: 'Complete Python Foundations first.',
    },
  ],
};

describe('learning recommendation contracts', () => {
  it('accepts bounded planning time and strips no undocumented input', () => {
    expect(RecommendationRequestSchema.parse({ available_minutes: 35 })).toEqual({ available_minutes: 35 });
    expect(RecommendationRequestSchema.safeParse({ available_minutes: true }).success).toBe(false);
    expect(RecommendationRequestSchema.safeParse({ available_minutes: 0 }).success).toBe(false);
    expect(RecommendationRequestSchema.safeParse({ available_minutes: 10081 }).success).toBe(false);
    expect(RecommendationRequestSchema.safeParse({ available_minutes: 20, mastery: [] }).success).toBe(false);
  });

  it('keeps missing evidence distinct from diagnostic starting signals and checkpoints', () => {
    expect(RecommendationResponseSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      RecommendationResponseSchema.safeParse({
        ...snapshot,
        mastery: [{ ...snapshot.mastery[0], state: 'mastered' }],
      }).success,
    ).toBe(false);
    expect(
      RecommendationResponseSchema.safeParse({
        ...snapshot,
        mastery: [{ ...snapshot.mastery[0], evidence: 'reading_time' }],
      }).success,
    ).toBe(false);
    expect(
      RecommendationResponseSchema.safeParse({
        ...snapshot,
        mastery: [{ ...snapshot.mastery[0], starting_signal: 'demonstrated' }],
      }).success,
    ).toBe(false);
  });
});
