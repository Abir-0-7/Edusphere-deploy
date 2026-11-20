import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, getEnvMock } = vi.hoisted(() => ({ authMock: vi.fn(), getEnvMock: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: authMock }));
vi.mock('@/env', () => ({ getEnv: getEnvMock }));

import { DELETE, GET, POST } from '../src/app/api/learning-service/[...path]/route';

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

  it('forwards an authenticated bibliography deletion with the account token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"deleted":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const id = '01234567-89ab-cdef-0123-456789abcdef';
    const response = await DELETE(
      new Request(`https://edusphere.example/api/learning-service/api/bibliography/${id}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ path: ['api', 'bibliography', id] }) },
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://studyvault-ai.example/api/bibliography/${id}`);
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer signed-clerk-token');
  });

  it('rejects cross-origin study writes and preserves approved audio event streams', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('data: {"done":true}\n\n', {
        headers: { 'content-type': 'text/event-stream', 'x-accel-buffering': 'no' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const url = 'https://edusphere.example/api/learning-service/api/tts/stream';
    const context = { params: Promise.resolve({ path: ['api', 'tts', 'stream'] }) };
    const rejected = await POST(
      new Request(url, { method: 'POST', headers: { origin: 'https://other.example' } }),
      context,
    );
    expect(rejected.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    const accepted = await POST(
      new Request(url, {
        method: 'POST',
        headers: { origin: 'https://edusphere.example', 'content-type': 'application/json' },
        body: '{"text":"example"}',
      }),
      context,
    );
    expect(accepted.headers.get('content-type')).toBe('text/event-stream');
    expect(accepted.headers.get('x-accel-buffering')).toBe('no');
    expect(await accepted.text()).toBe('data: {"done":true}\n\n');
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).has('x-internal-token')).toBe(false);
  });

  it('returns a retryable error when the host responds with a startup page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>Starting</html>', {
            status: 503,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );
    const response = await GET(
      new Request('https://edusphere.example/api/learning-service/api/flashcards/review-queue'),
      {
        params: Promise.resolve({ path: ['api', 'flashcards', 'review-queue'] }),
      },
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain('temporarily unavailable');
  });
});
