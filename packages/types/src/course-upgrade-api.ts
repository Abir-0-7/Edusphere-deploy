import { z } from 'zod';
import { SessionResponseSchema } from './course-api';

const Uuid = z.string().uuid().length(36);
const Hash = z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/);
const Revision = z.number().int().nonnegative();
const UpgradeId = z.string().refine((value) => {
  const size = [...value].length;
  return (
    size >= 1 && size <= 200 && !value.includes(String.fromCharCode(0)) && !/[\uD800-\uDFFF]/u.test(value)
  );
});
const LessonIds = z.array(UpgradeId).max(200);
const ObjectiveIds = z.array(UpgradeId).max(1000);
const ProjectPolicy = z.literal('old_kept_new_draft').default('old_kept_new_draft');
const ResetReason = z.enum([
  'new_lesson',
  'changed_teaching_or_assessment',
  'changed_prerequisite',
  'not_completed',
  'invalid_prior_checkpoint',
]);
const Binding = {
  from_enrollment_id: Uuid,
  from_document_id: Uuid,
  from_revision: Revision,
  from_release_id: Uuid,
  from_content_hash: Hash,
  target_release_id: Uuid,
  target_content_hash: Hash,
  preview_hash: Hash,
};

export const CourseUpgradePreviewRequestSchema = z.strictObject({ target_release_id: Uuid });

export const CourseUpgradePreviewSchema = z
  .strictObject({
    ...Binding,
    policy_version: z.literal('1').default('1'),
    course_id: Uuid,
    course_slug: UpgradeId,
    from_version: UpgradeId,
    target_version: UpgradeId,
    retained_lesson_ids: LessonIds,
    reset_lesson_ids: LessonIds,
    reset_reasons: z.array(z.strictObject({ lesson_id: UpgradeId, reason: ResetReason })).max(200),
    retained_objective_ids: ObjectiveIds,
    retained_note_count: z.number().int().min(0).max(100),
    retained_bookmark_count: z.number().int().min(0).max(100),
    project_policy: ProjectPolicy,
    warnings: z.array(z.string()).max(20),
  })
  .superRefine((preview, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (preview.from_release_id === preview.target_release_id) issue('Select a different release.');
    const lessons = [...preview.retained_lesson_ids, ...preview.reset_lesson_ids];
    if (
      new Set(lessons).size !== lessons.length ||
      new Set(preview.retained_objective_ids).size !== preview.retained_objective_ids.length
    ) {
      issue('Upgrade mappings must use unique identifiers.');
    }
    if (
      preview.reset_reasons.length !== preview.reset_lesson_ids.length ||
      preview.reset_reasons.some((entry, index) => entry.lesson_id !== preview.reset_lesson_ids[index])
    ) {
      issue('Every reset lesson requires one ordered explanation.');
    }
  });
export type CourseUpgradePreview = z.infer<typeof CourseUpgradePreviewSchema>;

export const CourseUpgradeApplyRequestSchema = z.strictObject({
  id: Uuid,
  expected_revision: Revision,
  target_release_id: Uuid,
  target_content_hash: Hash,
  preview_hash: Hash,
  accept_upgrade: z.literal(true),
});

export const CourseUpgradeResponseSchema = z
  .strictObject({
    session: SessionResponseSchema,
    receipt: z.strictObject({
      ...Binding,
      id: Uuid,
      to_enrollment_id: Uuid,
      retained_lesson_ids: LessonIds,
      retained_objective_ids: ObjectiveIds,
      project_policy: ProjectPolicy,
      created_at: z.string(),
    }),
    replayed: z.boolean(),
  })
  .refine(
    ({ session, receipt }) =>
      session.id === receipt.to_enrollment_id && session.release_id === receipt.target_release_id,
    'The receipt and session must refer to the same target enrollment.',
  );
