import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GenerationActionRequestSchema,
  GenerationApprovalRefSchema,
  GenerationListResponseSchema,
  GenerationPolicySchema,
  GenerationPreviewSchema,
  GenerationResumeRequestSchema,
  GenerationRunSchema,
  GenerationStageSchema,
  GenerationStageSpecSchema,
  GenerationStartRequestSchema,
  GenerationSummarySchema,
  LessonDraftSchema,
  type GenerationRun,
} from '../src/course-generation-api';

const models = {
  approval_ref: GenerationApprovalRefSchema,
  policy: GenerationPolicySchema,
  stage_spec: GenerationStageSpecSchema,
  preview: GenerationPreviewSchema,
  start_request: GenerationStartRequestSchema,
  action_request: GenerationActionRequestSchema,
  resume_request: GenerationResumeRequestSchema,
  lesson: LessonDraftSchema,
  stage: GenerationStageSchema,
  run: GenerationRunSchema,
  summary: GenerationSummarySchema,
  list: GenerationListResponseSchema,
};
const fixture: {
  valid: Record<string, unknown>;
  invalid: { name: string; schema: keyof typeof models; input: unknown }[];
  server_only_invalid: { name: string; schema: keyof typeof models; input: unknown }[];
} = JSON.parse(
  readFileSync(new URL('../../../contracts/course-generation-api.json', import.meta.url), 'utf8'),
);

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, ordered(child)]),
    );
  }
  return value;
}
const hash = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(ordered(value)), 'utf8')
    .digest('hex');
function runPreview(run: GenerationRun) {
  return {
    outline_id: run.outline_id,
    approval_id: run.approval_id,
    outline_revision: run.outline_revision,
    outline_content_hash: run.outline_content_hash,
    title: run.plan.title,
    policy: run.policy,
    stages: run.stages.map(({ id, module_id, title, input_bytes, token_upper_bound }) => ({
      id,
      module_id,
      title,
      input_bytes,
      token_upper_bound,
    })),
    maximum_tokens: run.maximum_tokens,
  };
}

describe('private bounded resumable module generation contracts', () => {
  it('round-trips every Python-generated request, preview, run state and response', () => {
    for (const [name, schema] of Object.entries(models)) {
      if (name !== 'run') expect(schema.parse(fixture.valid[name]), name).toEqual(fixture.valid[name]);
    }
    for (const state of ['pending', 'running', 'failed', 'uncertain', 'cancelled', 'resumed', 'completed']) {
      const name = `${state}_run`;
      expect(GenerationRunSchema.parse(fixture.valid[name]), name).toEqual(fixture.valid[name]);
    }
  });

  it.each(fixture.invalid)(
    'rejects $name with the same shape and semantic constraints as Python',
    (invalid) => {
      expect(models[invalid.schema].safeParse(invalid.input).success).toBe(false);
    },
  );

  it('binds the exact approved plan, preview policy and canonical Bengali Unicode hashes', () => {
    const preview = GenerationPreviewSchema.parse(fixture.valid.preview);
    const { preview_hash, ...content } = preview;
    expect(hash(content)).toBe(preview_hash);
    const run = GenerationRunSchema.parse(fixture.valid.completed_run);
    expect(hash(run.plan)).toBe(run.outline_content_hash);
    expect(hash(runPreview(run))).toBe(run.preview_hash);
    expect(run.plan.title).toContain('\u0986\u09b2\u09cb');
    expect(run.stages[0].output?.title).toContain('\ud83c\udf31');
  });

  it('retains completed output and allocated prior attempts across outage and resume', () => {
    const failed = GenerationRunSchema.parse(fixture.valid.failed_run);
    const resumed = GenerationRunSchema.parse(fixture.valid.resumed_run);
    const completed = GenerationRunSchema.parse(fixture.valid.completed_run);
    expect(failed.stages[0]).toEqual(resumed.stages[0]);
    expect(failed.stages[0]).toEqual(completed.stages[0]);
    expect(failed.stages[1].error_code).toBe('provider_unavailable');
    expect(resumed.stages[1].attempts).toBe(1);
    expect(resumed.stages[1].status).toBe('pending');
    expect(failed.allocated_tokens).toBe(resumed.allocated_tokens);
    expect(completed.allocated_tokens).toBe(30000);
    expect(completed.allocated_tokens).toBeLessThan(completed.maximum_tokens);
    expect(failed.preview_hash).toBe(completed.preview_hash);
    expect(completed.visibility).toBe('private');
    expect(completed.editorial_status).toBe('not_reviewed');
  });

  it('exposes cancellation and provider uncertainty without inventing a successful lesson', () => {
    const cancelled = GenerationRunSchema.parse(fixture.valid.cancelled_run);
    const uncertain = GenerationRunSchema.parse(fixture.valid.uncertain_run);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.stages[0].output).not.toBeNull();
    expect(cancelled.stages[1].output).toBeNull();
    expect(uncertain.stages[1].error_code).toBe('operation_uncertain');
    expect(uncertain.stages[1].output).toBeNull();
    expect(uncertain.allocated_tokens).toBeGreaterThan(cancelled.allocated_tokens);
  });

  it('accepts Unicode code-point boundaries and preserves meaningful whitespace as authored', () => {
    const lesson = LessonDraftSchema.parse(fixture.valid.lesson);
    expect(LessonDraftSchema.parse({ ...lesson, title: '\ud83c\udf31'.repeat(200) }).title).toHaveLength(400);
    expect(LessonDraftSchema.safeParse({ ...lesson, title: '\ud83c\udf31'.repeat(201) }).success).toBe(false);
    expect(LessonDraftSchema.safeParse({ ...lesson, title: '\ufeff' }).success).toBe(true);
    expect(LessonDraftSchema.parse({ ...lesson, answer: '  Exact authored answer.  ' }).answer).toBe(
      '  Exact authored answer.  ',
    );
    for (const value of ['\u001c', '\u0085', '\u2002', '\ud800', 'bad\0text']) {
      expect(LessonDraftSchema.safeParse({ ...lesson, explanation: value }).success).toBe(false);
    }
  });

  it('does not mistake browser hash-shape validation for cryptographic server approval', () => {
    for (const invalid of fixture.server_only_invalid) {
      const value = models[invalid.schema].parse(invalid.input);
      if (invalid.schema === 'preview') {
        const { preview_hash, ...content } = GenerationPreviewSchema.parse(value);
        expect(hash(content), invalid.name).not.toBe(preview_hash);
      } else {
        const run = GenerationRunSchema.parse(value);
        expect(
          hash(run.plan) !== run.outline_content_hash || hash(runPreview(run)) !== run.preview_hash,
          invalid.name,
        ).toBe(true);
      }
    }
  });
});
