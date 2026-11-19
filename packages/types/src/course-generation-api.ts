import { z } from 'zod';
import { OutlinePlanSchema } from './course-outline-api';

/** Private F04 generation drafts. Ownership, exact approval and cryptographic hashes are checked by the server. */
const Uuid = z.string().uuid().length(36);
const Hash = z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/);
const Identifier = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$(?![\s\S])/);
const PythonWhitespace = new Set([
  9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200,
  8201, 8202, 8232, 8233, 8239, 8287, 12288,
]);
const nonblank = (value: string): boolean =>
  [...value].some((character) => !PythonWhitespace.has(character.codePointAt(0)!));
function unicodeText(value: string, minimum: number, maximum: number): boolean {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    count += 1;
    if (count > maximum) return false;
  }
  return count >= minimum;
}
const boundedText = (minimum: number, maximum: number) =>
  z
    .string()
    .refine((value) => unicodeText(value, minimum, maximum), {
      message: `Text must contain ${minimum} to ${maximum} valid Unicode code points without NUL.`,
    });
const Title = boundedText(1, 200);
const WireString = boundedText(0, Infinity);
const Tokens = z.number().int().min(0).max(100000000);
const Revision = z.number().int().min(1);
const Optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

export const GenerationPolicySchema = z.strictObject({
  version: z.literal('1').default('1'),
  max_input_bytes: z.number().int().min(1).max(64000),
  max_output_tokens: z.number().int().min(1).max(4096),
  max_provider_attempts: z.number().int().min(1).max(20),
  max_stage_attempts: z.number().int().min(1).max(3),
  provider_fingerprint: Hash,
});
export type GenerationPolicy = z.infer<typeof GenerationPolicySchema>;

export const GenerationApprovalRefSchema = z.strictObject({
  outline_id: Uuid,
  approval_id: Uuid,
  outline_revision: z.number().int().min(1),
  outline_content_hash: Hash,
});
export type GenerationApprovalRef = z.infer<typeof GenerationApprovalRefSchema>;

export const GenerationReuseSchema = z.strictObject({
  parent_run_id: Uuid,
  parent_revision: Revision,
  parent_stage_id: Identifier,
  output_hash: Hash,
  prompt_hash: Hash,
  pins_hash: Hash,
});

export const GenerationStageSpecSchema = z.strictObject({
  id: Identifier,
  module_id: Identifier,
  title: Title,
  input_bytes: z.number().int().min(1).max(64000),
  token_upper_bound: z.number().int().min(1).max(2000000),
  reuse: Optional(GenerationReuseSchema),
});
export type GenerationStageSpec = z.infer<typeof GenerationStageSpecSchema>;

export const GenerationPreviewSchema = z
  .strictObject({
    ...GenerationApprovalRefSchema.shape,
    title: Title,
    policy: GenerationPolicySchema,
    stages: z.array(GenerationStageSpecSchema).min(1).max(30),
    maximum_tokens: Tokens,
    preview_hash: Hash,
  })
  .superRefine((preview, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (new Set(preview.stages.map((stage) => stage.id)).size !== preview.stages.length)
      issue('Generation stages must be unique.');
    const expected =
      preview.stages.reduce((sum, stage) => sum + (stage.reuse ? 0 : stage.token_upper_bound), 0) *
      preview.policy.max_stage_attempts;
    if (preview.maximum_tokens !== expected)
      issue('Generation budget must include every allowed stage attempt.');
    if (preview.stages.some((stage) => stage.input_bytes > preview.policy.max_input_bytes))
      issue('A generation stage exceeds the prompt byte limit.');
  });
export type GenerationPreview = z.infer<typeof GenerationPreviewSchema>;

export const GenerationStartRequestSchema = z.strictObject({
  ...GenerationApprovalRefSchema.shape,
  id: Uuid,
  preview_hash: Hash,
  accept_budget: z.literal(true),
});
export type GenerationStartRequest = z.infer<typeof GenerationStartRequestSchema>;

export const GenerationActionRequestSchema = z.strictObject({ expected_revision: z.number().int().min(1) });
export type GenerationActionRequest = z.infer<typeof GenerationActionRequestSchema>;

export const GenerationResumeRequestSchema = z.strictObject({
  ...GenerationActionRequestSchema.shape,
  accept_remaining_budget: z.literal(true),
});
export type GenerationResumeRequest = z.infer<typeof GenerationResumeRequestSchema>;

export const LessonDraftSchema = z
  .strictObject({
    title: Title,
    explanation: boundedText(1, 6000),
    worked_example: boundedText(1, 3000),
    question: boundedText(1, 1000),
    answer: boundedText(1, 1500),
    evidence_ids: z
      .array(z.enum(['pin-1', 'pin-2', 'pin-3', 'pin-4']))
      .min(1)
      .max(4),
  })
  .superRefine((lesson, context) => {
    if (
      [lesson.title, lesson.explanation, lesson.worked_example, lesson.question, lesson.answer].some(
        (text) => !nonblank(text),
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Lesson draft text must not be blank.' });
    }
    if (new Set(lesson.evidence_ids).size !== lesson.evidence_ids.length) {
      context.addIssue({ code: 'custom', message: 'Lesson evidence references must be unique.' });
    }
  });
export type LessonDraft = z.infer<typeof LessonDraftSchema>;

export const GenerationErrorSchema = z.enum([
  'provider_unavailable',
  'invalid_output',
  'operation_uncertain',
  'policy_changed',
  'worker_failed',
]);
export type GenerationError = z.infer<typeof GenerationErrorSchema>;

export const GenerationStageSchema = z
  .strictObject({
    ...GenerationStageSpecSchema.shape,
    status: z.enum(['pending', 'running', 'done', 'needs_retry']).default('pending'),
    attempts: z.number().int().min(0).max(3).default(0),
    output: LessonDraftSchema.nullable().default(null),
    error_code: GenerationErrorSchema.nullable().default(null),
  })
  .superRefine((stage, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if ((stage.status === 'done') !== (stage.output !== null))
      issue('Only completed stages have validated lesson output.');
    if (stage.reuse && (stage.status !== 'done' || stage.attempts !== 0 || stage.error_code !== null)) {
      issue('Reused stages must complete without a new provider attempt.');
    }
    if (['running', 'done', 'needs_retry'].includes(stage.status) && stage.attempts === 0 && !stage.reuse)
      issue('Started stages must retain their allocated attempt.');
    if ((stage.status === 'needs_retry') !== (stage.error_code !== null))
      issue('Retry stages must explain their failure.');
  });
export type GenerationStage = z.infer<typeof GenerationStageSchema>;

export const GenerationRunSchema = z
  .strictObject({
    ...GenerationApprovalRefSchema.shape,
    id: Uuid,
    plan: OutlinePlanSchema,
    preview_hash: Hash,
    policy: GenerationPolicySchema,
    job_id: Uuid,
    revision: z.number().int().min(1),
    status: z.enum(['pending', 'running', 'done', 'failed', 'cancelled']),
    stages: z.array(GenerationStageSchema).min(1).max(30),
    maximum_tokens: Tokens,
    allocated_tokens: z.number().int().min(0).max(100000000),
    visibility: z.literal('private').default('private'),
    editorial_status: z.literal('not_reviewed').default('not_reviewed'),
    created_at: WireString,
    updated_at: WireString,
    parent_run_id: Optional(Uuid),
    parent_run_revision: Optional(Revision),
    refresh_preview_hash: Optional(Hash),
    regenerate_objective_ids: Optional(z.array(Identifier).max(30)),
  })
  .superRefine((run, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    const order = run.plan.modules.flatMap((module) =>
      module.objective_ids.map((id) => [id, module.id] as const),
    );
    if (
      order.length !== run.stages.length ||
      order.some(([id, module], index) => {
        const stage = run.stages[index];
        return stage?.id !== id || stage.module_id !== module;
      })
    )
      issue('Generation stages must follow every approved module objective exactly once.');
    const objectives = new Map(run.plan.objectives.map((objective) => [objective.id, objective]));
    const lineage = [
      run.parent_run_id,
      run.parent_run_revision,
      run.refresh_preview_hash,
      run.regenerate_objective_ids,
    ];
    if (lineage.some((value) => value !== undefined) && !lineage.every((value) => value !== undefined)) {
      issue('Forked runs require complete immutable lineage.');
    }
    if (run.parent_run_id === run.id) issue('Generation cannot fork itself.');
    const selected = run.regenerate_objective_ids ?? [];
    if (new Set(selected).size !== selected.length || selected.some((id) => !objectives.has(id))) {
      issue('Regeneration selections must uniquely reference target objectives.');
    }
    if (order.length !== objectives.size) issue('Generation requires every objective assigned to a module.');
    for (const stage of run.stages) {
      if (
        stage.reuse &&
        (stage.reuse.parent_run_id !== run.parent_run_id ||
          stage.reuse.parent_revision !== run.parent_run_revision ||
          selected.includes(stage.id))
      ) {
        issue('Reused stages must bind the parent and cannot be selected for regeneration.');
      }
      if (stage.attempts > run.policy.max_stage_attempts) issue('Generation stage exhausted its budget.');
      if (stage.output !== null) {
        const allowed = new Set(
          objectives.get(stage.id)?.evidence.map((_, index) => `pin-${index + 1}`) ?? [],
        );
        if (stage.output.evidence_ids.some((id) => !allowed.has(id)))
          issue('Generated evidence must select approved pins for this exact objective.');
      }
    }
    const expected = run.stages.reduce((sum, stage) => sum + stage.token_upper_bound * stage.attempts, 0);
    if (run.allocated_tokens !== expected || run.allocated_tokens > run.maximum_tokens)
      issue('Generation allocation must retain all prior stage attempts.');
    const preview = GenerationPreviewSchema.safeParse({
      outline_id: run.outline_id,
      approval_id: run.approval_id,
      outline_revision: run.outline_revision,
      outline_content_hash: run.outline_content_hash,
      title: run.plan.title,
      policy: run.policy,
      stages: run.stages.map(({ id, module_id, title, input_bytes, token_upper_bound, reuse }) => ({
        id,
        module_id,
        title,
        input_bytes,
        token_upper_bound,
        reuse,
      })),
      maximum_tokens: run.maximum_tokens,
      preview_hash: run.preview_hash,
    });
    if (!preview.success) issue('Generation must retain its bounded preview.');
    if (run.status === 'done' && run.stages.some((stage) => stage.status !== 'done'))
      issue('Generation cannot complete with missing stages.');
  });
export type GenerationRun = z.infer<typeof GenerationRunSchema>;

export const GenerationSummarySchema = z
  .strictObject({
    id: Uuid,
    outline_id: Uuid,
    title: Title,
    status: z.enum(['pending', 'running', 'done', 'failed', 'cancelled']),
    completed_stages: z.number().int().min(0).max(30),
    total_stages: z.number().int().min(1).max(30),
    maximum_tokens: Tokens,
    allocated_tokens: z.number().int().min(0).max(100000000),
    updated_at: WireString,
  })
  .superRefine((summary, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (summary.completed_stages > summary.total_stages)
      issue('Generation progress cannot exceed its stage count.');
    if (summary.allocated_tokens > summary.maximum_tokens)
      issue('Generation allocation cannot exceed its accepted budget.');
    if (summary.status === 'done' && summary.completed_stages !== summary.total_stages)
      issue('Generation cannot complete with missing stages.');
  });
export type GenerationSummary = z.infer<typeof GenerationSummarySchema>;

export const GenerationListResponseSchema = z.strictObject({
  items: z.array(GenerationSummarySchema).max(50),
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().min(0),
  total_count: z.number().int().min(0),
});
export type GenerationListResponse = z.infer<typeof GenerationListResponseSchema>;

const RefreshRequestShape = {
  parent_run_id: Uuid,
  expected_parent_revision: Revision,
  target: GenerationApprovalRefSchema,
  regenerate_objective_ids: z
    .array(Identifier)
    .max(30)
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, 'Regeneration selections must be unique.'),
};
export const RefreshPreviewRequestSchema = z.strictObject(RefreshRequestShape);
export type RefreshPreviewRequest = z.infer<typeof RefreshPreviewRequestSchema>;

const RefreshStageDecisionSchema = z.strictObject({
  objective_id: Identifier,
  action: z.enum(['reuse', 'generate']),
  reason: boundedText(1, 500),
  has_saved_edit: z.boolean(),
  edit_disposition: z.enum(['reused', 'retained_in_parent', 'none']),
});

export const RefreshPreviewSchema = z
  .strictObject({
    parent_run_id: Uuid,
    parent_revision: Revision,
    target: GenerationPreviewSchema,
    decisions: z.array(RefreshStageDecisionSchema).min(1).max(30),
    new_work_token_ceiling: Tokens,
    retained_parent_allocated_tokens: Tokens,
    preview_hash: Hash,
  })
  .superRefine((preview, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (
      preview.decisions.length !== preview.target.stages.length ||
      preview.new_work_token_ceiling !== preview.target.maximum_tokens
    ) {
      issue('Refresh decisions must cover every target stage and the exact new work budget.');
    }
    for (const [index, decision] of preview.decisions.entries()) {
      const stage = preview.target.stages[index];
      const reuse = stage?.reuse;
      if (stage?.id !== decision.objective_id || (decision.action === 'reuse') !== (reuse !== undefined)) {
        issue('Refresh actions must match the ordered target stages.');
      }
      const expected = decision.has_saved_edit ? (reuse ? 'reused' : 'retained_in_parent') : 'none';
      if (decision.edit_disposition !== expected) issue('Refresh must explain saved edit preservation.');
    }
  });
export type RefreshPreview = z.infer<typeof RefreshPreviewSchema>;

export const RefreshStartRequestSchema = z.strictObject({
  ...RefreshRequestShape,
  id: Uuid,
  preview_hash: Hash,
  accept_budget: z.literal(true),
});

export const LessonEditRequestSchema = z.strictObject({
  expected_run_revision: Revision,
  expected_edit_revision: z.number().int().min(0).max(5),
  output: LessonDraftSchema,
});

const EditRevision = z.number().int().min(1).max(5);
export const GenerationLessonEditSchema = z
  .strictObject({
    run_id: Uuid,
    objective_id: Identifier,
    revision: EditRevision,
    output: LessonDraftSchema,
    created_at: WireString,
    copied_from_run_id: Optional(Uuid),
    copied_from_revision: Optional(EditRevision),
  })
  .refine(
    (edit) => (edit.copied_from_run_id === undefined) === (edit.copied_from_revision === undefined),
    'Copied edit history must retain its exact source.',
  );
export type GenerationLessonEdit = z.infer<typeof GenerationLessonEditSchema>;

export const LessonEditListResponseSchema = z.strictObject({
  items: z.array(GenerationLessonEditSchema).max(150),
});
