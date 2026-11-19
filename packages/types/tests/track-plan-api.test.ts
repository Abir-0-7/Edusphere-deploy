import { describe, expect, it } from 'vitest';
import {
  TrackChangeApplyRequestSchema,
  TrackChangePreviewSchema,
  TrackPlanResponseSchema,
} from '../src/track-plan-api';

const id = 'd638651b-d2e4-4e0d-80e9-2d5e6136f188';
const previewId = 'a'.repeat(64);

describe('track-plan contracts', () => {
  it('distinguishes suggested current plan from saved revision', () => {
    expect(
      TrackPlanResponseSchema.parse({ current_revision: 0, current_track_id: 'analyst', plan: null }),
    ).toEqual({ current_revision: 0, current_track_id: 'analyst', plan: null });
  });

  it('requires an explicit versioned plan preview before apply', () => {
    const request = {
      target_track_id: 'developer',
      expected_revision: 3,
      preview_id: previewId,
    };
    expect(TrackChangeApplyRequestSchema.parse(request)).toEqual(request);
    expect(
      TrackChangeApplyRequestSchema.safeParse({ ...request, completed_objective_ids: ['fabricated'] })
        .success,
    ).toBe(false);
    expect(TrackChangeApplyRequestSchema.safeParse({ ...request, preview_id: 'not-a-preview' }).success).toBe(
      false,
    );
  });

  it('documents unchanged pinned releases and separates plan revision from next action', () => {
    const preview = {
      preview_id: previewId,
      expected_revision: 3,
      plan_revision: 4,
      current_track_id: 'analyst',
      target_track_id: 'developer',
      required_course_slugs: ['python-foundations', 'pytorch-fundamentals'],
      required_objective_ids: ['py-loops-objective', 'pt-tensors-objective'],
      added_course_slugs: ['pytorch-fundamentals'],
      removed_course_slugs: [],
      added_objective_ids: ['pt-tensors-objective'],
      removed_objective_ids: [],
      preserved_completed_objective_ids: ['py-loops-objective'],
      completed_objectives_no_longer_required: [],
      objective_mapping: [
        {
          objective_id: 'py-loops-objective',
          status: 'shared',
          completed: true,
          attempts_preserved: 3,
        },
      ],
      pinned_releases: [{ enrollment_id: id, course_slug: 'python-foundations', release_id: id }],
      attempt_history_preserved: true,
      curriculum_release_changes: 0,
      change_kind: 'plan_revision',
      next_action: 'recompute_recommendations',
      notice:
        'A track change revises your plan only. Enrolled course releases and past attempts stay unchanged.',
    };
    expect(TrackChangePreviewSchema.parse(preview)).toEqual(preview);
    expect(TrackChangePreviewSchema.safeParse({ ...preview, next_action: 'complete_course' }).success).toBe(
      false,
    );
    expect(
      TrackChangePreviewSchema.safeParse({ ...preview, pinned_releases: [] }).data?.pinned_releases,
    ).toEqual([]);
  });
});
