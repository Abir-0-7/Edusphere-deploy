import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, getEnvMock } = vi.hoisted(() => ({ authMock: vi.fn(), getEnvMock: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
vi.mock('@/env', () => ({ getEnv: getEnvMock }));

import { GET } from '../src/app/api/learning-service/[...path]/route';

describe('learning service proxy route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    authMock.mockResolvedValue({ userId: 'user_123', getToken: async () => 'signed-clerk-token' });
    getEnvMock.mockReturnValue({
      AI_SERVICE_URL: 'https://studyvault-ai.example',
      AI_SERVICE_INTERNAL_TOKEN: 'server-secret',
    });
  });

  it('requires an authenticated account before proxying', async () => {
    authMock.mockResolvedValue({ userId: null, getToken: async () => null });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('https://edusphere.example/api/learning-service/api/courses'), {
      params: Promise.resolve({ path: ['api', 'courses'] }),
    });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards approved calls with the Clerk token and keeps the browser same-origin', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('[{"slug":"python-foundations"}]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('https://edusphere.example/api/learning-service/api/courses?source=home'),
      { params: Promise.resolve({ path: ['api', 'courses'] }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ slug: 'python-foundations' }]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://studyvault-ai.example/api/courses?source=home');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer signed-clerk-token');
    expect(new Headers(init?.headers).get('x-internal-token')).toBe('server-secret');
  });

  it('rejects routes outside the small learning API allowlist', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new Request('https://edusphere.example/api/learning-service/api/privacy/export'),
      { params: Promise.resolve({ path: ['api', 'privacy', 'export'] }) },
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
