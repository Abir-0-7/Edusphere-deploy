import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_OUTLINE_PLAN_BYTES,
  OutlineApprovalListResponseSchema,
  OutlineApprovalSchema,
  OutlineApproveRequestSchema,
  OutlineCoverageSchema,
  OutlineCreateRequestSchema,
  OutlineDeleteResponseSchema,
  OutlineListResponseSchema,
  OutlinePlanSchema,
  OutlineRecordSchema,
  OutlineSourceListResponseSchema,
  OutlineUpdateRequestSchema,
} from '../src/course-outline-api';

const models = {
  plan: OutlinePlanSchema,
  create_request: OutlineCreateRequestSchema,
  update_request: OutlineUpdateRequestSchema,
  approve_request: OutlineApproveRequestSchema,
  record: OutlineRecordSchema,
  coverage: OutlineCoverageSchema,
  approval: OutlineApprovalSchema,
  source_list: OutlineSourceListResponseSchema,
};
const fixture: {
  valid: Record<string, unknown>;
  invalid: { name: string; schema: keyof typeof models; input: unknown }[];
  server_only_invalid: { name: string; schema: keyof typeof models; input: unknown }[];
} = JSON.parse(readFileSync(new URL('../../../contracts/course-outline-api.json', import.meta.url), 'utf8'));

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

describe('private source coverage and outline approval contracts', () => {
  it('round-trips every Python-generated wire response/request without changing the fields', () => {
    for (const [name, schema] of [
      ['draft_plan', OutlinePlanSchema],
      ['ready_plan', OutlinePlanSchema],
      ['misordered_plan', OutlinePlanSchema],
      ['misordered_coverage', OutlineCoverageSchema],
      ['draft_coverage', OutlineCoverageSchema],
      ['ready_coverage', OutlineCoverageSchema],
      ['create_request', OutlineCreateRequestSchema],
      ['update_request', OutlineUpdateRequestSchema],
      ['approve_request', OutlineApproveRequestSchema],
      ['draft_record', OutlineRecordSchema],
      ['approved_record', OutlineRecordSchema],
      ['approval', OutlineApprovalSchema],
      ['approval_list', OutlineApprovalListResponseSchema],
      ['outline_list', OutlineListResponseSchema],
      ['source_list', OutlineSourceListResponseSchema],
      ['delete_response', OutlineDeleteResponseSchema],
    ] as const) {
      expect(schema.parse(fixture.valid[name]), name).toEqual(fixture.valid[name]);
    }
    for (const invalid of fixture.invalid) {
      expect(models[invalid.schema].safeParse(invalid.input).success, invalid.name).toBe(false);
    }
  });

  it('preserves Python canonical hashes, Bengali text and exact source pins through owner approval', () => {
    const draft = OutlineRecordSchema.parse(fixture.valid.draft_record);
    const approved = OutlineRecordSchema.parse(fixture.valid.approved_record);
    const approval = OutlineApprovalSchema.parse(fixture.valid.approval);
    expect(hash(draft.plan)).toBe(draft.content_hash);
    expect(hash(approved.plan)).toBe(approved.content_hash);
    expect(hash(approval.snapshot.plan)).toBe(approval.content_hash);
    expect(approval.revision).toBe(approved.revision);
    expect(approved.approval?.id).toBe(approval.id);
    expect(draft.plan.title).toContain('\u0986\u09b2\u09cb');
    expect(approved.plan.objectives[0].evidence).toEqual(draft.plan.objectives[0].evidence);
    expect(approved.plan.sources).toEqual(draft.plan.sources);
  });

  it('distinguishes missing support and overlap from a recorded human conflict decision', () => {
    const draft = OutlineRecordSchema.parse(fixture.valid.draft_record);
    expect(draft.coverage.gap_objective_ids).toEqual(['speed']);
    expect(draft.coverage.overlap_objective_ids).toEqual(['energy']);
    expect(draft.coverage.unresolved_conflict_ids).toEqual(['scope-review']);
    expect(draft.coverage.unreviewed_objective_ids).toEqual(['energy', 'speed']);
    expect(draft.coverage.estimated_minutes).toBe(40);
    expect(draft.coverage.ready_for_approval).toBe(false);
    const approved = OutlineRecordSchema.parse(fixture.valid.approved_record);
    expect(approved.coverage.ready_for_approval).toBe(true);
    expect(approved.coverage.estimated_minutes).toBe(25);
    expect(approved.plan.conflicts[0].resolution).not.toBeNull();
    expect(approved.visibility).toBe('private');
    expect(approved.editorial_status).toBe('not_reviewed');
    expect(approved.status).toBe('approved');
  });

  it('requires a strict current-revision request and separate explicit review acknowledgement', () => {
    const approve = OutlineApproveRequestSchema.parse(fixture.valid.approve_request);
    for (const reviewed_evidence of [false, 1, 0, 'true', null, undefined]) {
      expect(OutlineApproveRequestSchema.safeParse({ ...approve, reviewed_evidence }).success).toBe(false);
    }
    for (const expected_revision of [true, '2', 0, -1, 2.5]) {
      expect(OutlineApproveRequestSchema.safeParse({ ...approve, expected_revision }).success).toBe(false);
    }
    expect(OutlineApproveRequestSchema.safeParse({ ...approve, visibility: 'catalog' }).success).toBe(false);
    expect(OutlineApproveRequestSchema.safeParse({ ...approve, editorial_status: 'reviewed' }).success).toBe(
      false,
    );
    expect(
      OutlineApproveRequestSchema.safeParse({ ...approve, plan: fixture.valid.ready_plan }).success,
    ).toBe(false);
  });

  it('keeps prerequisite-order blockers visible even when all evidence is linked and reviewed', () => {
    const coverage = OutlineCoverageSchema.parse(fixture.valid.misordered_coverage);
    expect(coverage.misordered_objective_ids).toEqual(['apply-energy']);
    expect(coverage.gap_objective_ids).toEqual([]);
    expect(coverage.unmapped_objective_ids).toEqual([]);
    expect(coverage.unreviewed_objective_ids).toEqual([]);
    expect(coverage.unresolved_conflict_ids).toEqual([]);
    expect(coverage.ready_for_approval).toBe(false);
    const ready = OutlineCoverageSchema.parse(fixture.valid.ready_coverage);
    expect(ready.misordered_objective_ids).toEqual([]);
    const { misordered_objective_ids: omitted, ...oldCoverage } = ready;
    expect(omitted).toEqual([]);
    expect(OutlineCoverageSchema.parse(oldCoverage).misordered_objective_ids).toEqual([]);
  });

  it('allows an incomplete editable draft without silently accepting its missing support as approval', () => {
    const plan = OutlinePlanSchema.parse(fixture.valid.draft_plan);
    const objective = { ...plan.objectives[1], prerequisite_ids: [] };
    const incomplete = OutlinePlanSchema.parse({
      ...plan,
      objectives: [objective, ...plan.objectives.slice(0, 1)],
      modules: [{ ...plan.modules[0], objective_ids: ['energy'] }],
    });
    expect(incomplete.objectives[0].evidence).toEqual([]);
    expect(incomplete.objectives[0].review_status).toBe('needs_review');
    expect(incomplete.modules[0].objective_ids).not.toContain('speed');
    expect(
      OutlineApprovalSchema.safeParse({
        ...OutlineApprovalSchema.parse(fixture.valid.approval),
        snapshot: { plan: incomplete, coverage: fixture.valid.draft_coverage },
      }).success,
    ).toBe(false);
  });

  it('bounds valid Unicode, UTF-8 plan bytes, objective counts and selected evidence', () => {
    const plan = OutlinePlanSchema.parse(fixture.valid.ready_plan);
    expect(OutlinePlanSchema.safeParse({ ...plan, title: '\ud83c\udf31'.repeat(200) }).success).toBe(true);
    expect(OutlinePlanSchema.safeParse({ ...plan, title: '\ud83c\udf31'.repeat(201) }).success).toBe(false);
    for (const title of ['\u0085', '\u001c', '\ud800', 'Private\0draft']) {
      expect(OutlinePlanSchema.safeParse({ ...plan, title }).success).toBe(false);
    }
    expect(OutlinePlanSchema.safeParse({ ...plan, title: '\ufeff' }).success).toBe(true);
    const objective = plan.objectives[0];
    const pin = objective.evidence[0];
    const bounded = (quote: string, count: number) => ({
      ...plan,
      conflicts: [],
      objectives: Array.from({ length: count }, (_, index) => ({
        ...objective,
        id: `objective-${index}`,
        prerequisite_ids: [],
        evidence: [{ ...pin, quote }],
      })),
      modules: [
        {
          ...plan.modules[0],
          objective_ids: Array.from({ length: count }, (_, index) => `objective-${index}`),
        },
      ],
    });
    const small = bounded('\u0986'.repeat(1000), 30);
    expect(new TextEncoder().encode(JSON.stringify(small)).byteLength).toBeLessThan(MAX_OUTLINE_PLAN_BYTES);
    expect(OutlinePlanSchema.safeParse(small).success).toBe(true);
    const large = bounded('\u0986'.repeat(4000), 30);
    expect(new TextEncoder().encode(JSON.stringify(large)).byteLength).toBeGreaterThan(
      MAX_OUTLINE_PLAN_BYTES,
    );
    expect(OutlinePlanSchema.safeParse(large).success).toBe(false);
    expect(OutlinePlanSchema.safeParse(bounded('Evidence', 31)).success).toBe(false);
    expect(
      OutlinePlanSchema.safeParse({
        ...plan,
        objectives: [{ ...objective, evidence: Array.from({ length: 5 }, () => pin) }],
      }).success,
    ).toBe(false);
  });

  it('does not treat a syntactically valid hash as cryptographic approval proof', () => {
    for (const invalid of fixture.server_only_invalid) {
      const value = OutlineApprovalSchema.parse(invalid.input);
      expect(hash(value.snapshot.plan), invalid.name).not.toBe(value.content_hash);
    }
  });
});
