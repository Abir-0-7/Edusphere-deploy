import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse, type NextFetchEvent } from 'next/server';
import proxy from '../src/proxy';

const mocks = vi.hoisted(() => ({
  clerk: vi.fn<(request: NextRequest, event: NextFetchEvent) => NextResponse>(() => NextResponse.next()),
}));
vi.mock('@clerk/nextjs/server', () => ({ clerkMiddleware: () => mocks.clerk }));
const event = {} as NextFetchEvent;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('local demo proxy scope', () => {
  function enable() {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EDUSPHERE_LOCAL_DEMO', 'true');
  }

  it('marks only local game pages and game APIs without invoking Clerk', async () => {
    enable();
    for (const path of ['/games', '/games/cyberverse', '/api/game-vault/context']) {
      const response = await proxy(
        new NextRequest(`http://localhost:3000${path}`, { headers: { host: 'localhost:3000' } }),
        event,
      );
      expect(response?.headers.get('x-middleware-request-x-edusphere-local-demo')).toBe('1');
    }
    expect(mocks.clerk).not.toHaveBeenCalled();
  });

  it('blocks nonlocal hosts and unrelated routes in demo mode', async () => {
    enable();
    const remote = await proxy(
      new NextRequest('http://localhost:3000/games', { headers: { host: 'school.example' } }),
      event,
    );
    expect(remote?.status).toBe(403);
    const other = await proxy(
      new NextRequest('http://localhost:3000/dashboard', { headers: { host: 'localhost:3000' } }),
      event,
    );
    expect(other?.status).toBe(503);
    expect(mocks.clerk).not.toHaveBeenCalled();
  });

  it('delegates normal production requests to Clerk and removes forged demo markers', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EDUSPHERE_LOCAL_DEMO', 'false');
    await proxy(
      new NextRequest('https://school.example/games', { headers: { 'x-edusphere-local-demo': '1' } }),
      event,
    );
    expect(mocks.clerk).toHaveBeenCalledOnce();
    expect(mocks.clerk).toHaveBeenCalledOnce();
  });
});
