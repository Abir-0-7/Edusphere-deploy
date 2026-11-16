import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { config as proxyConfig } from '../src/proxy';

describe('OCR asset isolation', () => {
  it('excludes only the public OCR prefix from the Clerk proxy', () => {
    const pattern = proxyConfig.matcher[0];
    if (!pattern) throw new Error('Expected the application proxy matcher');
    const route = new RegExp('^' + pattern + '$');
    expect(route.test('/ocr/worker.min.js')).toBe(false);
    expect(route.test('/ocr/lang/eng.traineddata.gz')).toBe(false);
    expect(route.test('/ocr/lang/ben.traineddata.gz')).toBe(false);
    expect(route.test('/ocr-private')).toBe(true);
    expect(route.test('/tools')).toBe(true);
    expect(route.test('/api/private')).toBe(true);
  });

  it('keeps WebAssembly permission scoped to same-origin OCR asset responses', async () => {
    const headers = await nextConfig.headers?.();
    const assetPolicy = headers?.find((entry) => entry.source === '/ocr/:path*');
    expect(assetPolicy?.headers).toContainEqual({
      key: 'Content-Security-Policy',
      value: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'",
    });
    expect(headers?.find((entry) => entry.source === '/:path*')?.headers.some((entry) => entry.key === 'Content-Security-Policy')).toBe(false);
  });
});

