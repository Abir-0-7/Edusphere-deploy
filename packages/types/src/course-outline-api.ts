import { z } from 'zod';
import { EvidencePinSchema, type EvidencePin } from './source-version-api';

/** Private planning contracts (8.F03). Hashes, ownership and coverage remain server-authoritative. */
export const MAX_OUTLINE_PLAN_BYTES = 131072;
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

function unicodeText(value: string, minimum: number, maximum: number): boolean {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    length += 1;
    if (length > maximum) return false;
  }
  return length >= minimum;
}

const nonblank = (value: string): boolean =>
  [...value].some((character) => !PythonWhitespace.has(character.codePointAt(0)!));
const boundedText = (minimum: number, maximum: number) =>
  z
    .string()
    .refine((value) => unicodeText(value, minimum, maximum), {
      message: `Text must contain ${minimum} to ${maximum} valid Unicode code points without NUL.`,
    });
const WireString = boundedText(0, Infinity);
const Title = boundedText(1, 200);

/** Stable structural equality; UUID spelling is normalized as Pydantic's UUID fields are. */
function pinIdentity(pin: EvidencePin): string {
  const locator =
    pin.locator.kind === 'pdf'
      ? {
          ...pin.locator,
          chunk_id: pin.locator.chunk_id.toLowerCase(),
          chapter_id: pin.locator.chapter_id?.toLowerCase() ?? null,
        }
      : pin.locator;
  return JSON.stringify({ ...pin, version_id: pin.version_id.toLowerCase(), locator });
}

export const OutlineSourceSchema = z.strictObject({ version_id: Uuid, content_hash: Hash });
export type OutlineSource = z.infer<typeof OutlineSourceSchema>;

export const OutlineObjectiveSchema = z.strictObject({
  id: Identifier,
  title: Title,
  estimated_minutes: z.number().int().min(1).max(600),
  prerequisite_ids: z.array(Identifier).max(8).default([]),
  evidence: z.array(EvidencePinSchema).max(4).default([]),
  review_status: z.enum(['needs_review', 'reviewed']).default('needs_review'),
});
export type OutlineObjective = z.infer<typeof OutlineObjectiveSchema>;

export const OutlineModuleSchema = z.strictObject({
  id: Identifier,
  title: Title,
  objective_ids: z.array(Identifier).min(1).max(30),
});
export type OutlineModule = z.infer<typeof OutlineModuleSchema>;

export const OutlineConflictSchema = z
  .strictObject({
    id: Identifier,
    objective_id: Identifier,
    first: EvidencePinSchema,
    second: EvidencePinSchema,
    description: boundedText(1, 1000),
    resolution: boundedText(1, 1000).nullable().default(null),
  })
  .superRefine((conflict, context) => {
    if (pinIdentity(conflict.first) === pinIdentity(conflict.second)) {
      context.addIssue({ code: 'custom', message: 'Conflict flags need two different evidence pins.' });
    }
    if (conflict.resolution !== null && !nonblank(conflict.resolution)) {
      context.addIssue({
        code: 'custom',
        path: ['resolution'],
        message: 'Explain how the conflict was resolved.',
      });
    }
  });
export type OutlineConflict = z.infer<typeof OutlineConflictSchema>;

export const OutlinePlanSchema = z
  .strictObject({
    schema_version: z.literal(1).default(1),
    title: Title,
    outcome: boundedText(1, 2000),
    sources: z.array(OutlineSourceSchema).min(1).max(8),
    objectives: z.array(OutlineObjectiveSchema).min(1).max(30),
    modules: z.array(OutlineModuleSchema).min(1).max(12),
    conflicts: z.array(OutlineConflictSchema).max(20).default([]),
  })
  .superRefine((plan, context) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      context.addIssue({ code: 'custom', path, message });
    if (!nonblank(plan.title) || !nonblank(plan.outcome)) issue('Outline title and outcome cannot be blank.');
    const identifiers = new Set(plan.objectives.map((objective) => objective.id));
    const sources = new Map(
      plan.sources.map((source) => [source.version_id.toLowerCase(), source.content_hash]),
    );
    if (identifiers.size !== plan.objectives.length || sources.size !== plan.sources.length) {
      issue('Outline objectives and selected sources must be unique.');
    }
    if (new Set(plan.modules.map((module) => module.id)).size !== plan.modules.length)
      issue('Module identifiers must be unique.');
    if (new Set(plan.conflicts.map((conflict) => conflict.id)).size !== plan.conflicts.length)
      issue('Conflict identifiers must be unique.');
    const objectives = new Map(plan.objectives.map((objective) => [objective.id, objective]));
    plan.objectives.forEach((objective, index) => {
      if (!nonblank(objective.title))
        issue('Objective titles cannot be blank.', ['objectives', index, 'title']);
      if (
        new Set(objective.prerequisite_ids).size !== objective.prerequisite_ids.length ||
        objective.prerequisite_ids.includes(objective.id) ||
        objective.prerequisite_ids.some((identifier) => !identifiers.has(identifier))
      ) {
        issue('Prerequisites must uniquely reference other objectives.', [
          'objectives',
          index,
          'prerequisite_ids',
        ]);
      }
      const seen = new Set<string>();
      objective.evidence.forEach((pin, pinIndex) => {
        if (sources.get(pin.version_id.toLowerCase()) !== pin.content_hash) {
          issue('Evidence must use the selected source version and hash.', [
            'objectives',
            index,
            'evidence',
            pinIndex,
          ]);
        }
        const signature = pinIdentity(pin);
        if (seen.has(signature) || !nonblank(pin.quote))
          issue('Evidence must be distinct and quote actual text.');
        seen.add(signature);
      });
    });
    const visited = new Set<string>();
    const visiting = new Set<string>();
    function visit(identifier: string): boolean {
      if (visiting.has(identifier)) return false;
      if (visited.has(identifier)) return true;
      visiting.add(identifier);
      for (const prerequisite of objectives.get(identifier)?.prerequisite_ids ?? []) {
        if (!visit(prerequisite)) return false;
      }
      visiting.delete(identifier);
      visited.add(identifier);
      return true;
    }
    if (plan.objectives.some((objective) => !visit(objective.id)))
      issue('Objective prerequisites cannot form a cycle.');
    const assigned: string[] = [];
    plan.modules.forEach((module, index) => {
      if (
        !nonblank(module.title) ||
        module.objective_ids.some((identifier) => !identifiers.has(identifier))
      ) {
        issue('Modules need titles and known objective identifiers.', ['modules', index]);
      }
      assigned.push(...module.objective_ids);
    });
    if (new Set(assigned).size !== assigned.length) issue('An objective can appear in only one module.');
    plan.conflicts.forEach((conflict, index) => {
      const objective = objectives.get(conflict.objective_id);
      const evidence = objective?.evidence.map(pinIdentity) ?? [];
      if (
        !objective ||
        !evidence.includes(pinIdentity(conflict.first)) ||
        !evidence.includes(pinIdentity(conflict.second))
      ) {
        issue('Conflict evidence must be linked to the referenced objective.', ['conflicts', index]);
      }
    });
    if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > MAX_OUTLINE_PLAN_BYTES)
      issue('Outline exceeds the 128 KiB UTF-8 limit.');
  });
export type OutlinePlan = z.infer<typeof OutlinePlanSchema>;

export const ObjectiveCoverageSchema = z.strictObject({
  objective_id: Identifier,
  status: z.enum(['gap', 'linked', 'overlap']),
  source_version_ids: z.array(Uuid).max(8),
  evidence_count: z.number().int().min(0).max(4),
  reviewed: z.boolean(),
});
export type ObjectiveCoverage = z.infer<typeof ObjectiveCoverageSchema>;

export const OutlineCoverageSchema = z.strictObject({
  coverage_version: z.literal(1).default(1),
  objectives: z.array(ObjectiveCoverageSchema).max(30),
  gap_objective_ids: z.array(Identifier).max(30),
  overlap_objective_ids: z.array(Identifier).max(30),
  unreviewed_objective_ids: z.array(Identifier).max(30),
  unmapped_objective_ids: z.array(Identifier).max(30),
  misordered_objective_ids: z.array(Identifier).max(30).default([]),
  unused_source_version_ids: z.array(Uuid).max(8),
  unresolved_conflict_ids: z.array(Identifier).max(20),
  estimated_minutes: z.number().int().min(1).max(18000),
  ready_for_approval: z.boolean(),
});
export type OutlineCoverage = z.infer<typeof OutlineCoverageSchema>;

export const OutlineCreateRequestSchema = z.strictObject({ id: Uuid, plan: OutlinePlanSchema });
export type OutlineCreateRequest = z.infer<typeof OutlineCreateRequestSchema>;
export const OutlineUpdateRequestSchema = z.strictObject({
  expected_revision: z.number().int().min(1),
  plan: OutlinePlanSchema,
});
export type OutlineUpdateRequest = z.infer<typeof OutlineUpdateRequestSchema>;
export const OutlineApproveRequestSchema = z.strictObject({
  expected_revision: z.number().int().min(1),
  content_hash: Hash,
  reviewed_evidence: z
    .boolean()
    .refine((value) => value, { message: 'Explicit evidence review is required.' }),
});
export type OutlineApproveRequest = z.infer<typeof OutlineApproveRequestSchema>;

export const OutlineApprovalReceiptSchema = z.strictObject({
  id: Uuid,
  revision: z.number().int().min(1),
  content_hash: Hash,
  created_at: WireString,
});
export type OutlineApprovalReceipt = z.infer<typeof OutlineApprovalReceiptSchema>;
export const OutlineApprovalSnapshotSchema = z.strictObject({
  plan: OutlinePlanSchema,
  coverage: OutlineCoverageSchema,
});
export type OutlineApprovalSnapshot = z.infer<typeof OutlineApprovalSnapshotSchema>;
export const OutlineApprovalSchema = OutlineApprovalReceiptSchema.extend({
  outline_id: Uuid,
  snapshot: OutlineApprovalSnapshotSchema,
}).refine((value) => value.snapshot.coverage.ready_for_approval, {
  message: 'Approval snapshot must contain approval-ready coverage.',
});
export type OutlineApproval = z.infer<typeof OutlineApprovalSchema>;

export const OutlineRecordSchema = z.strictObject({
  id: Uuid,
  revision: z.number().int().min(1),
  content_hash: Hash,
  plan: OutlinePlanSchema,
  coverage: OutlineCoverageSchema,
  status: z.enum(['draft', 'approved']),
  visibility: z.literal('private').default('private'),
  editorial_status: z.literal('not_reviewed').default('not_reviewed'),
  approval: OutlineApprovalReceiptSchema.nullable().default(null),
  created_at: WireString,
  updated_at: WireString,
});
export type OutlineRecord = z.infer<typeof OutlineRecordSchema>;

export const OutlineSummarySchema = z.strictObject({
  id: Uuid,
  title: Title,
  revision: z.number().int().min(1),
  status: z.enum(['draft', 'approved']),
  estimated_minutes: z.number().int().min(1).max(18000),
  source_count: z.number().int().min(1).max(8),
  objective_count: z.number().int().min(1).max(30),
  content_hash: Hash,
  updated_at: WireString,
});
export type OutlineSummary = z.infer<typeof OutlineSummarySchema>;
export const OutlineListResponseSchema = z.strictObject({
  items: z.array(OutlineSummarySchema).max(50),
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().min(0),
  total_count: z.number().int().min(0),
});
export type OutlineListResponse = z.infer<typeof OutlineListResponseSchema>;
export const OutlineApprovalListResponseSchema = z.strictObject({
  items: z.array(OutlineApprovalSchema).max(50),
});
export type OutlineApprovalListResponse = z.infer<typeof OutlineApprovalListResponseSchema>;
export const OutlineDeleteResponseSchema = z.strictObject({ deleted: z.literal(true).default(true) });
export type OutlineDeleteResponse = z.infer<typeof OutlineDeleteResponseSchema>;
export const OutlineSourceSummarySchema = z.strictObject({
  id: Uuid,
  content_hash: Hash,
  title: boundedText(1, 500),
  kind: z.enum(['pdf', 'github', 'text']),
  segment_count: z.number().int().min(1).max(2000),
  created_at: WireString,
});
export type OutlineSourceSummary = z.infer<typeof OutlineSourceSummarySchema>;
export const OutlineSourceListResponseSchema = z.strictObject({
  items: z.array(OutlineSourceSummarySchema).max(50),
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().min(0),
  total_count: z.number().int().min(0),
});
export type OutlineSourceListResponse = z.infer<typeof OutlineSourceListResponseSchema>;
