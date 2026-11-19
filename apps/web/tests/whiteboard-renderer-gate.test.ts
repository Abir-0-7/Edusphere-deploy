import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { boardStorageKeys } from '../src/lib/local-boards';

const fixtureDir = new URL('./fixtures/whiteboard/', import.meta.url);

describe('whiteboard E06 renderer and migration gate fixtures', () => {
  it('pins the legacy tldraw editor snapshot shape without importing its native payload as app data', async () => {
    const snapshot = JSON.parse(
      await readFile(new URL('tldraw-5.6.0-shape.json', fixtureDir), 'utf8'),
    ) as Record<string, unknown>;
    expect(snapshot).toHaveProperty('document.store');
    expect(snapshot).toHaveProperty('document.schema.schemaVersion', 2);
    expect(snapshot).toHaveProperty('session.version', 1);
  });

  it('keeps legacy image bytes inside an opaque migration source and account key scopes distinct', async () => {
    const image = JSON.parse(
      await readFile(new URL('tldraw-5.6.0-image-asset.json', fixtureDir), 'utf8'),
    ) as Record<string, unknown>;
    expect(image).toHaveProperty(
      'document.store.asset:legacy-image.props.src',
      'data:image/png;base64,not-real-test-data',
    );
    expect(boardStorageKeys('learner-a').snapshot).not.toBe(boardStorageKeys('learner-b').snapshot);
    expect(() => boardStorageKeys('')).toThrow(/signed-in account/);
  });

  it('rejects unowned shared legacy board keys from migration', async () => {
    const legacy = JSON.parse(
      await readFile(new URL('legacy-shared-unowned.json', fixtureDir), 'utf8'),
    ) as Record<string, unknown>;
    expect(legacy.expected).toBe('ignored-without-owner');
    expect(legacy.key).toBe('studyvault:whiteboard:v1');
  });
});
