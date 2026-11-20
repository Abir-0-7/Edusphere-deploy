import { z } from 'zod';

export const WHITEBOARD_SNAPSHOT_LIMITS = {
  envelopeBytes: 5 * 1024 * 1024,
  elements: 10_000,
  files: 200,
  singleFileBytes: 10 * 1024 * 1024,
  boardFilesBytes: 50 * 1024 * 1024,
  maxDepth: 32,
  maxStringBytes: 100 * 1024,
} as const;

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string().max(WHITEBOARD_SNAPSHOT_LIMITS.maxStringBytes),
    z.array(JsonValueSchema).max(20_000),
    z
      .record(z.string().max(160), JsonValueSchema)
      .refine(
        (record) =>
          Object.keys(record).every((key) => !['__proto__', 'constructor', 'prototype'].includes(key)),
        'Prototype-bearing object keys are not allowed.',
      ),
  ]),
);

const BoardElementSchema = z.record(z.string().max(160), JsonValueSchema);

export const WhiteboardSceneSchema = z
  .strictObject({
    elements: z.array(BoardElementSchema).max(WHITEBOARD_SNAPSHOT_LIMITS.elements),
    app_state: z.strictObject({
      viewBackgroundColor: z.string().max(32).optional(),
      gridSize: z.number().finite().min(0).max(512).nullable().optional(),
      zoom: z.number().finite().min(0.1).max(10).optional(),
      scrollX: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
      scrollY: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
    }),
    file_ids: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/)).max(WHITEBOARD_SNAPSHOT_LIMITS.files),
  })
  .superRefine((scene, context) => {
    const ids = new Set<string>();
    const types = new Set([
      'selection',
      'rectangle',
      'diamond',
      'ellipse',
      'line',
      'arrow',
      'freedraw',
      'text',
      'image',
      'frame',
      'magicframe',
    ]);
    const imageIds = new Set<string>();
    for (const [index, element] of scene.elements.entries()) {
      if (typeof element.type !== 'string' || !types.has(element.type)) {
        context.addIssue({
          code: 'custom',
          path: ['elements', index, 'type'],
          message: 'Unsupported whiteboard element type.',
        });
      }
      if (typeof element.id === 'string' && element.id.length > 0 && element.id.length <= 160) {
        if (ids.has(element.id))
          context.addIssue({
            code: 'custom',
            path: ['elements', index, 'id'],
            message: 'Element IDs must be unique.',
          });
        ids.add(element.id);
      } else {
        context.addIssue({
          code: 'custom',
          path: ['elements', index, 'id'],
          message: 'Elements require bounded nonempty IDs.',
        });
      }
      if (element.type === 'image') {
        if (typeof element.fileId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(element.fileId)) {
          context.addIssue({
            code: 'custom',
            path: ['elements', index, 'fileId'],
            message: 'Images require an authorized file ID.',
          });
        } else imageIds.add(element.fileId);
      }
      const inspect = (value: JsonValue, path: (string | number)[], depth: number): void => {
        if (depth > WHITEBOARD_SNAPSHOT_LIMITS.maxDepth) {
          context.addIssue({
            code: 'custom',
            path,
            message: 'Scene JSON exceeds the maximum nesting depth.',
          });
          return;
        }
        if (
          typeof value === 'string' &&
          new TextEncoder().encode(value).byteLength > WHITEBOARD_SNAPSHOT_LIMITS.maxStringBytes
        ) {
          context.addIssue({ code: 'custom', path, message: 'Scene text exceeds the maximum length.' });
        } else if (Array.isArray(value)) {
          value.forEach((child, childIndex) => inspect(child, [...path, childIndex], depth + 1));
        } else if (value && typeof value === 'object') {
          for (const [key, child] of Object.entries(value)) {
            if (
              (key === 'src' || key === 'dataURL' || key === 'fileData') &&
              typeof child === 'string' &&
              /^(?:https?:|data:|blob:)/i.test(child)
            ) {
              context.addIssue({
                code: 'custom',
                path: [...path, key],
                message: 'Remote or inline binary content must use an authorized opaque asset reference.',
              });
            } else {
              inspect(child, [...path, key], depth + 1);
            }
          }
        }
      };
      inspect(element, ['elements', index], 0);
    }
    for (const [index, element] of scene.elements.entries()) {
      const refs = [element.containerId, element.frameId];
      for (const key of ['startBinding', 'endBinding']) {
        const binding = element[key];
        if (binding !== null && binding !== undefined) {
          refs.push(
            typeof binding === 'object' && !Array.isArray(binding) ? (binding.elementId ?? false) : false,
          );
        }
      }
      const bound = element.boundElements;
      if (bound !== null && bound !== undefined) {
        if (!Array.isArray(bound)) refs.push(false);
        else
          for (const item of bound)
            refs.push(item && typeof item === 'object' && !Array.isArray(item) ? (item.id ?? false) : false);
      }
      if (
        refs.some(
          (reference) =>
            reference !== undefined &&
            reference !== null &&
            (typeof reference !== 'string' || !ids.has(reference)),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['elements', index],
          message: 'Bindings must reference elements in the same scene.',
        });
      }
    }
    if (imageIds.size !== scene.file_ids.length || scene.file_ids.some((id) => !imageIds.has(id))) {
      context.addIssue({
        code: 'custom',
        path: ['file_ids'],
        message: 'Image references must match scene file IDs, including deleted images for undo.',
      });
    }
    if (new Set(scene.file_ids).size !== scene.file_ids.length) {
      context.addIssue({ code: 'custom', path: ['file_ids'], message: 'Asset IDs must be unique.' });
    }
  });

export const WhiteboardSnapshotSchema = z
  .strictObject({
    format: z.literal('studyvault-whiteboard'),
    schema_version: z.literal(1),
    board_id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    revision: z.number().int().positive(),
    updated_at: z.string().datetime({ offset: true }),
    renderer: z.strictObject({ id: z.literal('excalidraw'), version: z.literal('0.18.1') }),
    scene: WhiteboardSceneSchema,
  })
  .superRefine((snapshot, context) => {
    const visit = (value: JsonValue, path: (string | number)[], depth: number): void => {
      if (depth > WHITEBOARD_SNAPSHOT_LIMITS.maxDepth) {
        context.addIssue({ code: 'custom', path, message: 'Snapshot exceeds the maximum nesting depth.' });
        return;
      }
      if (Array.isArray(value)) value.forEach((child, index) => visit(child, [...path, index], depth + 1));
      else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, child]) => visit(child, [...path, key], depth + 1));
      }
    };
    visit(snapshot.scene as JsonValue, ['scene'], 0);
  });

export type WhiteboardSnapshot = z.infer<typeof WhiteboardSnapshotSchema>;

export const WhiteboardCreateRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  scene: WhiteboardSceneSchema,
});
export const WhiteboardUpdateRequestSchema = WhiteboardCreateRequestSchema.extend({
  expected_revision: z.number().int().positive(),
});
export const WhiteboardListResponseSchema = z.strictObject({
  items: z.array(WhiteboardSnapshotSchema).max(100),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative(),
});

export const WhiteboardAssetManifestSchema = z.strictObject({
  id: z.string().uuid(),
  file_id: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
  mime_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  size_bytes: z.number().int().positive().max(WHITEBOARD_SNAPSHOT_LIMITS.singleFileBytes),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  created_at: z.string().datetime({ offset: true }).optional(),
});
export type WhiteboardAssetManifest = z.infer<typeof WhiteboardAssetManifestSchema>;
export const WhiteboardAssetListResponseSchema = z.strictObject({
  assets: z.array(WhiteboardAssetManifestSchema).max(200),
});
export const WhiteboardAssetUploadSchema = z.strictObject({
  file_id: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
  mime_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  data_base64: z
    .string()
    .min(4)
    .max(Math.ceil(WHITEBOARD_SNAPSHOT_LIMITS.singleFileBytes / 3) * 4 + 4),
});

export function parseWhiteboardSnapshot(input: unknown): WhiteboardSnapshot {
  const serialized = JSON.stringify(input);
  if (typeof serialized !== 'string') throw new Error('Whiteboard snapshot must be serializable JSON.');
  const size = new TextEncoder().encode(serialized).byteLength;
  if (size > WHITEBOARD_SNAPSHOT_LIMITS.envelopeBytes)
    throw new Error('Whiteboard snapshots are limited to 5 MiB.');
  return WhiteboardSnapshotSchema.parse(input);
}

export function validateWhiteboardAssets(
  fileIds: string[],
  manifests: WhiteboardAssetManifest[],
): WhiteboardAssetManifest[] {
  if (manifests.length > WHITEBOARD_SNAPSHOT_LIMITS.files)
    throw new Error('A board may use at most 200 images.');
  const parsed = manifests.map((manifest) => WhiteboardAssetManifestSchema.parse(manifest));
  const ids = new Set(parsed.map(({ id }) => id));
  if (ids.size !== parsed.length) throw new Error('Asset IDs must be unique.');
  const fileKeys = new Set(parsed.map(({ file_id }) => file_id));
  if (fileKeys.size !== parsed.length) throw new Error('Renderer file IDs must be unique.');
  if (parsed.length !== fileIds.length || parsed.some(({ file_id }) => !fileIds.includes(file_id))) {
    throw new Error('Scene asset references must match the authorized owner-scoped asset manifest.');
  }
  if (parsed.reduce((sum, asset) => sum + asset.size_bytes, 0) > WHITEBOARD_SNAPSHOT_LIMITS.boardFilesBytes) {
    throw new Error('Board image storage is limited to 50 MiB.');
  }
  return parsed;
}

export function classifyLegacyTldrawSnapshot(
  payload: unknown,
  ownerScopedKey: boolean,
): 'migrate-with-review' | 'reject-unowned' | 'reject-unsupported' {
  if (!ownerScopedKey) return 'reject-unowned';
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'reject-unsupported';
  const candidate = payload as Record<string, unknown>;
  const document = candidate.document;
  if (
    document &&
    typeof document === 'object' &&
    'store' in document &&
    'schema' in document &&
    'session' in candidate
  ) {
    return 'migrate-with-review';
  }
  return 'reject-unsupported';
}
