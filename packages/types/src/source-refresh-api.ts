import { z } from 'zod';
import { SourceLocatorSchema } from './source-version-api';

const Uuid = z.string().uuid().length(36);
const Hash = z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/);
const Nonnegative = z.number().int().nonnegative();
const PageSize = z.number().int().min(1).max(50);
const SafeText = z
  .string()
  .refine((value) => !value.includes(String.fromCharCode(0)) && !/[\uD800-\uDFFF]/u.test(value));
const bounded = (minimum: number, maximum: number) =>
  SafeText.refine((value) => {
    const size = [...value].length;
    return size >= minimum && size <= maximum;
  });
const Effect = z.enum(['changed', 'moved', 'removed']);

export const SourceImpactRequestSchema = z
  .strictObject({
    old_version_id: Uuid,
    new_version_id: Uuid,
    limit: PageSize.default(20),
    offset: Nonnegative.max(100000).default(0),
  })
  .refine(
    (request) => request.old_version_id.toLowerCase() !== request.new_version_id.toLowerCase(),
    'Choose two different prepared source versions.',
  );

const SegmentChangeSchema = z.strictObject({
  change: z.enum(['unchanged', 'changed', 'moved', 'removed', 'added']),
  old_segment_id: SafeText.nullable().default(null),
  new_segment_id: SafeText.nullable().default(null),
  old_locator: SourceLocatorSchema.nullable().default(null),
  new_locator: SourceLocatorSchema.nullable().default(null),
  old_excerpt: bounded(0, 500).nullable().default(null),
  new_excerpt: bounded(0, 500).nullable().default(null),
});

const ArtifactImpactSchema = z.strictObject({
  kind: z.enum(['card', 'map_node', 'map_edge', 'outline_objective', 'generated_lesson', 'course_lesson']),
  id: bounded(1, 120),
  parent_id: bounded(1, 120),
  title: bounded(1, 500),
  reason: Effect,
  document_id: Uuid.nullable().default(null),
  revision: Nonnegative.nullable().default(null),
  content_hash: Hash,
  edited: z.boolean().nullable().default(null),
});

export const SourceImpactResponseSchema = z.strictObject({
  old_version_id: Uuid,
  new_version_id: Uuid,
  old_content_hash: Hash,
  new_content_hash: Hash,
  counts: z.strictObject({
    unchanged: Nonnegative,
    changed: Nonnegative,
    moved: Nonnegative,
    removed: Nonnegative,
    added: Nonnegative,
  }),
  segments: z.array(SegmentChangeSchema).max(50),
  segments_truncated: z.boolean(),
  artifacts: z.array(ArtifactImpactSchema).max(50),
  total_artifacts: Nonnegative,
  artifacts_truncated: z.boolean(),
  limit: PageSize,
  offset: Nonnegative,
  limitations: z.array(z.string()).max(12),
});
export type SourceImpactResponse = z.infer<typeof SourceImpactResponseSchema>;
