import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  WHITEBOARD_SNAPSHOT_LIMITS,
  WhiteboardAssetManifestSchema,
  WhiteboardSnapshotSchema,
  classifyLegacyTldrawSnapshot,
  parseWhiteboardSnapshot,
  validateWhiteboardAssets,
} from '../src/lib/whiteboard-contract';

const BOARD_ID = '4ab81a4d-68a9-4127-9595-c310ee6529a0';
const ASSET_ID = 'f82dcb92-e613-4b14-b64a-270f7ddb782b';
const base = {
  format: 'studyvault-whiteboard',
  schema_version: 1,
  board_id: BOARD_ID,
  title: 'Study board',
  revision: 1,
  updated_at: '2026-11-19T00:00:00.000Z',
  renderer: { id: 'excalidraw', version: '0.18.1' },
  scene: { elements: [{ id: 'shape-1', type: 'rectangle', x: 12, y: 14 }], app_state: {}, file_ids: [] },
};
const fixtureDir = new URL('./fixtures/whiteboard/', import.meta.url);

describe('E06 app-owned whiteboard contract', () => {
  it('accepts the exact versioned scene contract and keeps owner identity outside the payload', () => {
    expect(parseWhiteboardSnapshot(base)).toEqual(base);
    expect(WhiteboardSnapshotSchema.safeParse({ ...base, owner_user_id: 'not-trusted' }).success).toBe(false);
    expect(
      WhiteboardSnapshotSchema.safeParse({ ...base, renderer: { id: 'tldraw', version: '5.6.0' } }).success,
    ).toBe(false);
  });

  it('rejects remote/inline assets, embeds, prototype keys, deep values, and duplicate element IDs', () => {
    expect(
      WhiteboardSnapshotSchema.safeParse({
        ...base,
        scene: { ...base.scene, elements: [{ id: 'x', type: 'embed' }] },
      }).success,
    ).toBe(false);
    expect(
      WhiteboardSnapshotSchema.safeParse({
        ...base,
        scene: { ...base.scene, elements: [{ id: 'x', src: 'https://example.org/a.png' }] },
      }).success,
    ).toBe(false);
    expect(
      WhiteboardSnapshotSchema.safeParse({
        ...base,
        scene: { ...base.scene, elements: [{ id: 'x', dataURL: 'data:image/png;base64,AAAA' }] },
      }).success,
    ).toBe(false);
    expect(
      WhiteboardSnapshotSchema.safeParse({
        ...base,
        scene: { ...base.scene, elements: [{ id: 'x' }, { id: 'x' }] },
      }).success,
    ).toBe(false);
    expect(() =>
      parseWhiteboardSnapshot(JSON.parse('{"format":"studyvault-whiteboard","__proto__":{}}')),
    ).toThrow();
    let deep: unknown = 'leaf';
    for (let index = 0; index <= WHITEBOARD_SNAPSHOT_LIMITS.maxDepth; index += 1) deep = [deep];
    expect(
      WhiteboardSnapshotSchema.safeParse({
        ...base,
        scene: { ...base.scene, elements: [{ id: 'x', nested: deep }] },
      }).success,
    ).toBe(false);
  });

  it('checks owner-scoped image references, hash/type metadata, per-file and aggregate limits', () => {
    const asset = {
      id: ASSET_ID,
      file_id: 'legacy-file',
      mime_type: 'image/png',
      size_bytes: 12,
      sha256: 'a'.repeat(64),
    } as const;
    expect(validateWhiteboardAssets([asset.file_id], [asset])).toEqual([asset]);
    expect(() => validateWhiteboardAssets([ASSET_ID], [])).toThrow(/authorized owner-scoped/);
    expect(() => WhiteboardAssetManifestSchema.parse({ ...asset, mime_type: 'text/html' })).toThrow();
    expect(() =>
      validateWhiteboardAssets(
        [asset.file_id],
        [{ ...asset, size_bytes: WHITEBOARD_SNAPSHOT_LIMITS.singleFileBytes + 1 }],
      ),
    ).toThrow();
    expect(() => validateWhiteboardAssets([asset.file_id, asset.file_id], [asset, asset])).toThrow(/unique/);
    const many = Array.from({ length: 6 }, (_, index) => ({
      ...asset,
      id: index === 0 ? ASSET_ID : `dd3185c4-225f-4a9d-ae99-34e1b97c8${String(index).padStart(3, '0')}`,
      file_id: `legacy-file-${index}`,
      size_bytes: 9 * 1024 * 1024,
    }));
    expect(() =>
      validateWhiteboardAssets(
        many.map(({ file_id }) => file_id),
        many,
      ),
    ).toThrow(/50 MiB/);
  });

  it('classifies legacy native data only when reached through an owner-specific v2 key', async () => {
    const snapshot = JSON.parse(
      await readFile(new URL('tldraw-5.6.0-shape.json', fixtureDir), 'utf8'),
    ) as unknown;
    const assets = JSON.parse(
      await readFile(new URL('tldraw-5.6.0-image-asset.json', fixtureDir), 'utf8'),
    ) as unknown;
    const unowned = JSON.parse(await readFile(new URL('legacy-shared-unowned.json', fixtureDir), 'utf8')) as {
      key: string;
    };
    expect(classifyLegacyTldrawSnapshot(snapshot, true)).toBe('migrate-with-review');
    expect(classifyLegacyTldrawSnapshot(assets, true)).toBe('migrate-with-review');
    expect(classifyLegacyTldrawSnapshot(snapshot, false)).toBe('reject-unowned');
    expect(unowned.key).toBe('studyvault:whiteboard:v1');
    expect(classifyLegacyTldrawSnapshot({ random: true }, true)).toBe('reject-unsupported');
  });
});
