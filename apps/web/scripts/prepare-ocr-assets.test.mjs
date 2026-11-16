import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import { ensureVerifiedDownload } from './prepare-ocr-assets.mjs';

const bytes = Buffer.from('verified OCR model fixture');
const expectedHash = createHash('sha256').update(bytes).digest('hex');
const url = 'https://models.example.test/eng.traineddata.gz';

async function withDestination(run) {
  const temporaryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/ocr-tests');
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, 'edusphere-ocr-'));
  const destination = path.join(directory, 'model.gz');
  // Only remove the exact test directory that mkdtemp created under the ignored test cache.
  if (path.dirname(directory) !== temporaryRoot || !path.basename(directory).startsWith('edusphere-ocr-')) {
    throw new Error('Unexpected OCR test cleanup path');
  }
  try {
    await run(destination);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('verified cached assets need no network access', async () => {
  await withDestination(async (destination) => {
    await writeFile(destination, bytes);
    await ensureVerifiedDownload({ url, expectedHash, destination, fetcher: async () => { throw new Error('Network must not be used'); } });
    assert.deepEqual(await readFile(destination), bytes);
  });
});

test('a corrupt cached asset is replaced only with matching downloaded bytes', async () => {
  await withDestination(async (destination) => {
    await writeFile(destination, 'corrupt cache');
    await ensureVerifiedDownload({ url, expectedHash, destination, fetcher: async (requestedUrl) => {
      assert.equal(requestedUrl, url);
      return { ok: true, arrayBuffer: async () => bytes };
    } });
    assert.deepEqual(await readFile(destination), bytes);
  });
});

test('unexpected downloaded bytes are rejected without publishing an asset', async () => {
  await withDestination(async (destination) => {
    await assert.rejects(ensureVerifiedDownload({ url, expectedHash, destination, fetcher: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('tampered') }) }), /integrity mismatch/);
    await assert.rejects(readFile(destination), { code: 'ENOENT' });
  });
});

test('HTTP failures fail the build instead of publishing an error page as a model', async () => {
  await withDestination(async (destination) => {
    await assert.rejects(ensureVerifiedDownload({ url, expectedHash, destination, fetcher: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
    await assert.rejects(readFile(destination), { code: 'ENOENT' });
  });
});
