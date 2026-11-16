import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeVersion = '7.0.0';
const modelVersion = '1.0.0';
const models = [
  { language: 'eng', sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91' },
  { language: 'ben', sha256: 'a7c1fd170b796d6b8d01b401d4bfcc54409f47b313a200e9e3756ce20d742725' },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Reuse a verified cache entry; never publish unverified downloaded bytes. */
export async function ensureVerifiedDownload({ url, expectedHash, destination, fetcher = globalThis.fetch }) {
  try {
    const existing = await readFile(destination);
    if (sha256(existing) === expectedHash) return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetcher(url, { signal: globalThis.AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`OCR asset download failed: HTTP ${response.status} for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== expectedHash) throw new Error(`OCR asset integrity mismatch: ${url}`);
  await writeFile(destination, bytes);
}

export async function prepareOcrAssets() {
  const tesseractPackagePath = require.resolve('tesseract.js/package.json');
  const tesseractRoot = path.dirname(tesseractPackagePath);
  const corePackagePath = createRequire(tesseractPackagePath).resolve('tesseract.js-core/package.json');
  const coreRoot = path.dirname(corePackagePath);
  for (const packagePath of [tesseractPackagePath, corePackagePath]) {
    const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
    if (metadata.version !== runtimeVersion) {
      throw new Error(`OCR assets expect ${metadata.name}@${runtimeVersion}; found ${metadata.version}. Review the runtime and model pins before upgrading.`);
    }
  }

  const assetRoot = path.join(webRoot, 'public', 'ocr');
  const coreDestination = path.join(assetRoot, 'core');
  const languageDestination = path.join(assetRoot, 'lang');
  await Promise.all([mkdir(coreDestination, { recursive: true }), mkdir(languageDestination, { recursive: true })]);
  await Promise.all([
    copyFile(path.join(tesseractRoot, 'dist', 'worker.min.js'), path.join(assetRoot, 'worker.min.js')),
    copyFile(path.join(tesseractRoot, 'dist', 'worker.min.js.LICENSE.txt'), path.join(assetRoot, 'worker.min.js.LICENSE.txt')),
    copyFile(path.join(coreRoot, 'LICENSE'), path.join(assetRoot, 'LICENSE-tesseract.js-core.txt')),
    ...['', '-lstm', '-simd', '-simd-lstm', '-relaxedsimd', '-relaxedsimd-lstm'].map((variant) => {
      const filename = `tesseract-core${variant}.wasm.js`;
      return copyFile(path.join(coreRoot, filename), path.join(coreDestination, filename));
    }),
    ...models.map(({ language, sha256: expectedHash }) => ensureVerifiedDownload({
      // Versioned npm package files, verified against integrity-checked npm tarballs.
      url: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}@${modelVersion}/4.0.0_best_int/${language}.traineddata.gz`,
      expectedHash,
      destination: path.join(languageDestination, `${language}.traineddata.gz`),
    })),
  ]);
  await writeFile(path.join(assetRoot, 'NOTICE.txt'), [
    `Generated OCR runtime: tesseract.js ${runtimeVersion}; tesseract.js-core ${runtimeVersion}.`,
    `Language data: @tesseract.js-data/eng and @tesseract.js-data/ben ${modelVersion}, 4.0.0_best_int.`,
    'Upstream: https://github.com/naptha/tesseract.js and https://github.com/naptha/tessdata.',
    'Runtime/core: Apache-2.0. The @tesseract.js-data language packages declare MIT; retain upstream notices.',
    ...models.map(({ language, sha256: hash }) => `${language}.traineddata.gz SHA-256 ${hash}`),
    '',
  ].join('\n'));
  process.stdout.write(`Prepared same-origin OCR assets (Tesseract ${runtimeVersion}; English and Bangla models ${modelVersion}).\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareOcrAssets();
}
