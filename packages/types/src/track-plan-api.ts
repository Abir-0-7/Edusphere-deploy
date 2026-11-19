import { z } from 'zod';

export const TrackIdSchema = z.enum(['analyst', 'developer', 'programming-exam']);
export type TrackId = z.infer<typeof TrackIdSchema>;
const CourseSlug = z.enum(['python-foundations', 'pytorch-fundamentals']);
const Revision = z.number().int().nonnegative();
const PreviewId = z.string().regex(/^[0-9a-f]{64}$/);
const Mapping = z.strictObject({
  objective_id: z.string(),
  status: z.enum(['shared', 'new_requirement', 'no_longer_required']),
  completed: z.boolean(),
  attempts_preserved: Revision,
});
const TrackDefinition = z.strictObject({
  id: TrackIdSchema,
  title: z.string(),
  description: z.string(),
  goal_kind: z.enum(['academic', 'career']),
  required_course_slugs: z.array(CourseSlug),
  required_objective_ids: z.array(z.string()),
});
const PinnedRelease = z.strictObject({
  enrollment_id: z.uuid(),
  course_slug: CourseSlug,
  release_id: z.uuid(),
});
const Current = z.strictObject({ current_track_id: TrackIdSchema, current_revision: Revision });
const SavedPlan = z.strictObject({
  revision: Revision.min(1),
  track_id: TrackIdSchema,
  required_course_slugs: z.array(CourseSlug),
  required_objective_ids: z.array(z.string()),
  objective_mapping: z.array(Mapping),
  created_at: z.iso.datetime({ offset: true }),
});

export const TrackCatalogResponseSchema = Current.extend({ tracks: z.array(TrackDefinition) });
export const TrackPlanResponseSchema = Current.extend({ plan: SavedPlan.nullable() });
export const TrackPlanHistoryResponseSchema = Current.extend({
  history: z.array(SavedPlan),
  next_before_revision: Revision.min(1).nullable(),
});
export const TrackChangeRequestSchema = z.strictObject({ target_track_id: TrackIdSchema });
export const TrackChangeApplyRequestSchema = TrackChangeRequestSchema.extend({
  expected_revision: Revision,
  preview_id: PreviewId,
});
export const TrackChangePreviewSchema = z
  .strictObject({
    preview_id: PreviewId,
    expected_revision: Revision,
    plan_revision: Revision.min(1),
    current_track_id: TrackIdSchema,
    target_track_id: TrackIdSchema,
    required_course_slugs: z.array(CourseSlug),
    required_objective_ids: z.array(z.string()),
    added_course_slugs: z.array(CourseSlug),
    removed_course_slugs: z.array(CourseSlug),
    added_objective_ids: z.array(z.string()),
    removed_objective_ids: z.array(z.string()),
    preserved_completed_objective_ids: z.array(z.string()),
    completed_objectives_no_longer_required: z.array(z.string()),
    objective_mapping: z.array(Mapping),
    pinned_releases: z.array(PinnedRelease),
    attempt_history_preserved: z.literal(true),
    curriculum_release_changes: z.literal(0),
    change_kind: z.literal('plan_revision'),
    next_action: z.literal('recompute_recommendations'),
    notice: z.literal(
      'A track change revises your plan only. Enrolled course releases and past attempts stay unchanged.',
    ),
  })
  .superRefine((value, context) => {
    const required = new Set(value.required_objective_ids);
    const removed = new Set(value.removed_objective_ids);
    for (const objective of value.preserved_completed_objective_ids) {
      if (!required.has(objective))
        context.addIssue({
          code: 'custom',
          path: ['preserved_completed_objective_ids'],
          message: 'Preserved objective is not required.',
        });
    }
    for (const objective of value.completed_objectives_no_longer_required) {
      if (!removed.has(objective))
        context.addIssue({
          code: 'custom',
          path: ['completed_objectives_no_longer_required'],
          message: 'Removed objective mapping is invalid.',
        });
    }
  });
export const TrackChangeAppliedSchema = SavedPlan.extend({
  pinned_releases_unchanged: z.literal(true),
  prior_attempts_unchanged: z.literal(true),
});
export type TrackCatalogResponse = z.infer<typeof TrackCatalogResponseSchema>;
export type TrackPlanHistoryResponse = z.infer<typeof TrackPlanHistoryResponseSchema>;
export type TrackChangePreview = z.infer<typeof TrackChangePreviewSchema>;
