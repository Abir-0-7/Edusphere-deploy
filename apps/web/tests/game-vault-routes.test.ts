import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../src/app/api/game-vault/context/route';
import { POST as unlock } from '../src/app/api/game-vault/unlock/route';
import { POST as progress } from '../src/app/api/game-vault/progress/route';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), unlock: vi.fn(), complete: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('@/lib/game-vault/server', () => ({
  contextFor: mocks.context,
  unlockMission: mocks.unlock,
  completeMission: mocks.complete,
}));

const state = {
  mode: 'production',
  tokens: 95,
  xp: 0,
  unlocked: ['binary_city'],
  completed: [],
  achievements: [],
  student: { id: 'student-id', displayName: 'Student' },
};
function mutation(path: string, body: unknown, origin = 'https://school.example') {
  return new Request(`https://school.example/api/game-vault/${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const input = { gameId: 'cyberverse', missionId: 'binary_city', requestId: 'operation-1' };

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'clerk_student' });
  mocks.context.mockResolvedValue(state);
  mocks.unlock.mockResolvedValue({ state });
  mocks.complete.mockResolvedValue({
    state: { ...state, xp: 100, completed: ['binary_city'], achievements: ['first_transmission'] },
  });
});

describe('local offline Game Vault API isolation', () => {
  function localMutation(path: string, body: unknown) {
    return new Request(`http://localhost:3000/api/game-vault/${path}`, {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  function enableLocalDemo() {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EDUSPHERE_LOCAL_DEMO', 'true');
  }

  it('returns an explicit unavailable demo context without Clerk or database calls', async () => {
    enableLocalDemo();
    const response = await GET(
      new Request('http://localhost:3000/api/game-vault/context?gameId=cyberverse', {
        headers: { host: 'localhost:3000' },
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: false, error: 'local_demo_mode', mode: 'demo' });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it('rejects server mutations in local demo rather than touching the production wallet', async () => {
    enableLocalDemo();
    for (const response of [
      await unlock(localMutation('unlock', input)),
      await progress(localMutation('progress', { ...input, evidence: {} })),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: 'local_demo_client_only' });
    }
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('retains authentication for non-loopback requests even when development demo is enabled', async () => {
    enableLocalDemo();
    mocks.auth.mockResolvedValue({ userId: null });
    const response = await GET(
      new Request('https://school.example/api/game-vault/context?gameId=cyberverse'),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(mocks.auth).toHaveBeenCalledOnce();
  });

  it('retains authentication on localhost in production even with the demo flag set', async () => {
    enableLocalDemo();
    vi.stubEnv('NODE_ENV', 'production');
    mocks.auth.mockResolvedValue({ userId: null });
    const responses = [
      await GET(new Request('http://localhost:3000/api/game-vault/context?gameId=cyberverse')),
      await unlock(localMutation('unlock', input)),
      await progress(localMutation('progress', { ...input, evidence: {} })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' });
    }
    expect(mocks.auth).toHaveBeenCalledTimes(3);
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('retains authentication when the local demo flag is absent', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EDUSPHERE_LOCAL_DEMO', 'false');
    mocks.auth.mockResolvedValue({ userId: null });
    const response = await GET(new Request('http://localhost:3000/api/game-vault/context?gameId=cyberverse'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(mocks.auth).toHaveBeenCalledOnce();
  });
});

describe('Game Vault authenticated API boundary', () => {
  it('loads only the scoped signed-in context and never caches it', async () => {
    const response = await GET(
      new Request('https://school.example/api/game-vault/context?gameId=cyberverse'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, state });
    expect(mocks.context).toHaveBeenCalledWith('clerk_student');
  });
  it('rejects unknown games rather than returning unrelated student progress', async () => {
    const response = await GET(new Request('https://school.example/api/game-vault/context?gameId=unknown'));
    expect(response.status).toBe(404);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it('preserves existing authentication for every route', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    for (const response of [
      await GET(new Request('https://school.example/api/game-vault/context?gameId=cyberverse')),
      await unlock(mutation('unlock', input)),
      await progress(mutation('progress', { ...input, evidence: {} })),
    ]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' });
    }
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('rejects cross-origin mutations before authorizing or spending', async () => {
    for (const response of [
      await unlock(mutation('unlock', input, 'https://attacker.example')),
      await progress(mutation('progress', { ...input, evidence: {} }, 'https://attacker.example')),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.unlock).not.toHaveBeenCalled();
  });
  it('rejects missing operation IDs and unsupported game identifiers', async () => {
    for (const bad of [
      { ...input, requestId: '' },
      { ...input, gameId: 'arbitrary' },
      { ...input, missionId: '' },
    ]) {
      expect((await unlock(mutation('unlock', bad))).status).toBe(400);
    }
    expect(mocks.unlock).not.toHaveBeenCalled();
  });
  it('never accepts client price or student ID as authority', async () => {
    const response = await unlock(mutation('unlock', { ...input, price: 0, studentId: 'someone_else' }));
    expect(response.status).toBe(200);
    expect(mocks.unlock).toHaveBeenCalledWith('clerk_student', 'binary_city');
    expect(await response.json()).toEqual({ ok: true, missionId: 'binary_city', state });
  });
  it('reports insufficient funds without inventing a fallback wallet', async () => {
    mocks.unlock.mockResolvedValue({ error: 'insufficient_tokens' });
    const response = await unlock(mutation('unlock', input));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: 'insufficient_tokens' });
  });
  it('forwards only evidence for server validation, not requested XP or achievements', async () => {
    const evidence = { challengeVersion: 'binary-v1', answers: [1, 2, 0, 3, 2, 0] };
    const response = await progress(
      mutation('progress', { ...input, evidence, xpEarned: 999999, achievements: ['fake'] }),
    );
    expect(response.status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith('clerk_student', 'binary_city', evidence);
    expect((await response.json()).state.xp).toBe(100);
  });
  it('reports rejected completion with no success state', async () => {
    mocks.complete.mockResolvedValue({ error: 'completion_rejected' });
    const response = await progress(mutation('progress', { ...input, evidence: {} }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, error: 'completion_rejected' });
  });
  it('reports a database outage as unavailable without exposing internals', async () => {
    mocks.context.mockRejectedValue(new Error('private database URL'));
    mocks.unlock.mockRejectedValue(new Error('private database URL'));
    mocks.complete.mockRejectedValue(new Error('private database URL'));
    const responses = [
      await GET(new Request('https://school.example/api/game-vault/context?gameId=cyberverse')),
      await unlock(mutation('unlock', input)),
      await progress(mutation('progress', { ...input, evidence: {} })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: 'service_unavailable' });
    }
  });
});
