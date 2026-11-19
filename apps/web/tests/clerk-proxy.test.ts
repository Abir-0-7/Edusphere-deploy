import { NextRequest, type NextFetchEvent } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([
  ['/v1/environment', 'application/json', '{"object":"environment"}'],
  ['/npm/@clerk/clerk-js@6/dist/clerk.browser.js', 'application/javascript', '/* Clerk JS */'],
])('forwards %s when an explicit Clerk proxy URL is configured', async (path, contentType, body) => {
  const proxyUrl = 'https://edusphere.example/__clerk';
  vi.stubEnv('NEXT_PUBLIC_CLERK_PROXY_URL', proxyUrl);
  const publishableKey = `pk_live_${Buffer.from('clerk.edusphere.example$').toString('base64')}`;
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', publishableKey);
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_live_test_placeholder');
  vi.stubEnv('CLERK_FAPI_URL', undefined);
  const fetchUpstream = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(async () =>
    new Response(body, { headers: { 'content-type': contentType } }),
  );
  vi.stubGlobal('fetch', fetchUpstream);

  const { default: proxy } = await import('../src/proxy');
  const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
  const response = await proxy(new NextRequest(`${proxyUrl}${path}`), event);

  expect(fetchUpstream).toHaveBeenCalledExactlyOnceWith(
    `https://frontend-api.clerk.dev${path}`,
    expect.objectContaining({ method: 'GET', headers: expect.any(Headers) }),
  );
  expect(new Headers(fetchUpstream.mock.calls[0]?.[1].headers).get('Clerk-Proxy-Url')).toBe(proxyUrl);
  expect(response?.status).toBe(200);
  expect(response?.headers.get('content-type')).toBe(contentType);
  await expect(response?.text()).resolves.toBe(body);
});
