import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CyberverseResponseSchema, ErrorEnvelopeSchema } from '@studyvault/types';
import { GET as context } from '../src/app/api/game-vault/context/route';
import { POST as unlock } from '../src/app/api/game-vault/unlock/route';
import { POST as progress } from '../src/app/api/game-vault/progress/route';
import { validBinaryEvidence } from '../src/lib/game-vault/mission-rules';

const mocks = vi.hoisted(() => ({
  owner: 'clerk-alice' as string | null,
  authError: false,
  context: vi.fn(),
  unlock: vi.fn(),
  complete: vi.fn(),
}));
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => {
    if (mocks.authError) throw new Error('private Clerk connection details');
    return { userId: mocks.owner };
  },
}));
vi.mock('../src/lib/game-vault/server', () => ({
  contextFor: (...args: unknown[]) => mocks.context(...args),
  unlockMission: (...args: unknown[]) => mocks.unlock(...args),
  completeMission: (...args: unknown[]) => mocks.complete(...args),
}));

const evidence = { challengeVersion: 'binary-v1', answers: [1, 2, 0, 3, 2, 0] };
const input = { gameId: 'cyberverse', missionId: 'binary_city', requestId: 'request-1' };
const state = {
  mode: 'production',
  tokens: 3,
  xp: 100,
  unlocked: ['binary_city'],
  completed: ['binary_city'],
  achievements: ['first_transmission'],
  student: { id: 'alice', displayName: 'Student Explorer' },
};
function request(body: unknown, origin: string | null = 'https://study.test') {
  return new Request('https://study.test/api/game-vault/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owner = 'clerk-alice';
  mocks.authError = false;
  mocks.context.mockResolvedValue(state);
  mocks.unlock.mockResolvedValue({ state });
  mocks.complete.mockResolvedValue({ state });
});

describe('authenticated Cyberverse HTTP boundary', () => {
  it('returns the same no-cache focus lock for unlock and progress writes', async () => {
    mocks.unlock.mockResolvedValue({ error: 'focus_active' });
    mocks.complete.mockResolvedValue({ error: 'focus_active' });
    for (const response of [await unlock(request(input)), await progress(request({ ...input, evidence }))]) {
      expect(response.status).toBe(409);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(ErrorEnvelopeSchema.parse(await response.json()).error.code).toBe('conflict');
    }
  });
  it('returns production state without cache or private identity fields', async () => {
    const reply = await context(new Request('https://study.test/api/game-vault/context?gameId=cyberverse'));
    expect(reply.status).toBe(200);
    expect(reply.headers.get('cache-control')).toBe('no-store');
    expect(CyberverseResponseSchema.parse(await reply.json())).toEqual({ ok: true, state });
    expect(mocks.context).toHaveBeenCalledWith('clerk-alice');
    expect(
      (await context(new Request('https://study.test/api/game-vault/context?gameId=other'))).status,
    ).toBe(404);
    mocks.context.mockResolvedValue(null);
    expect(
      (await context(new Request('https://study.test/api/game-vault/context?gameId=cyberverse'))).status,
    ).toBe(404);
  });

  it('requires a signed-in account and same-origin mutations before calling the backend', async () => {
    expect((await unlock(request(input, 'https://evil.test'))).status).toBe(403);
    expect((await unlock(request(input, null))).status).toBe(403);
    expect((await progress(request({ ...input, evidence }, 'https://evil.test'))).status).toBe(403);
    mocks.owner = null;
    expect(
      (await context(new Request('https://study.test/api/game-vault/context?gameId=cyberverse'))).status,
    ).toBe(401);
    expect((await unlock(request(input))).status).toBe(401);
    expect((await progress(request({ ...input, evidence }))).status).toBe(401);
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it('bounds chunked body input and rejects injected scores, identities, XP and demo overrides', async () => {
    for (const extra of [
      { amount: -500 },
      { xp: 1000000 },
      { userId: 'bob' },
      { mode: 'demo' },
      { gameId: 'other' },
    ]) {
      const reply = await unlock(request({ ...input, ...extra }));
      expect(reply.status).toBe(400);
      ErrorEnvelopeSchema.parse(await reply.json());
    }
    const tooLarge = new Request('https://study.test/api/game-vault/unlock', {
      method: 'POST',
      headers: { origin: 'https://study.test' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(5000)));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect((await unlock(tooLarge)).status).toBe(400);
    expect(mocks.unlock).not.toHaveBeenCalled();
  });

  it('passes only typed mission/evidence data and uses the shared success and error contracts', async () => {
    expect(CyberverseResponseSchema.parse(await (await unlock(request(input))).json()).state).toEqual(state);
    expect(mocks.unlock).toHaveBeenCalledWith('clerk-alice', 'binary_city');
    expect((await progress(request({ ...input, evidence }))).status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith('clerk-alice', 'binary_city', evidence);
    mocks.unlock.mockResolvedValue({ error: 'mission_not_playable' });
    const preview = await unlock(request({ ...input, missionId: 'code_district' }));
    expect(preview.status).toBe(409);
    expect(ErrorEnvelopeSchema.parse(await preview.json()).error).toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining('preview'),
    });
    mocks.unlock.mockResolvedValue({ error: 'insufficient_tokens' });
    expect((await unlock(request(input))).status).toBe(409);
    mocks.complete.mockResolvedValue({ error: 'mission_locked' });
    expect((await progress(request({ ...input, evidence }))).status).toBe(409);
    mocks.complete.mockResolvedValue({ error: 'completion_rejected' });
    expect((await progress(request({ ...input, evidence }))).status).toBe(422);
  });

  it('rejects malformed evidence and sanitizes auth/database failures', async () => {
    for (const invalid of [
      { ...evidence, challengeVersion: 'binary-v2' },
      { ...evidence, answers: [true, 2, 0, 3, 2, 0] },
      { ...evidence, correct: true },
    ]) {
      expect((await progress(request({ ...input, evidence: invalid }))).status).toBe(400);
    }
    expect(mocks.complete).not.toHaveBeenCalled();
    mocks.unlock.mockRejectedValue(new Error('private database password'));
    const failed = await unlock(request(input));
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain('password');
    mocks.authError = true;
    const authFailed = await context(
      new Request('https://study.test/api/game-vault/context?gameId=cyberverse'),
    );
    expect(authFailed.status).toBe(503);
    ErrorEnvelopeSchema.parse(await authFailed.json());
  });
});

describe('binary-v1 server-held evidence grading', () => {
  it('accepts only the pinned six exact numeric answers', () => {
    expect(validBinaryEvidence(evidence)).toBe(true);
    for (const invalid of [
      null,
      [],
      'binary-v1',
      { ...evidence, extra: true },
      { ...evidence, challengeVersion: 'other' },
      { ...evidence, answers: [1, 2, 0, 3, 2] },
      { ...evidence, answers: [1, 2, 0, 3, 2, false] },
      { ...evidence, answers: [1, 2, 0, 3, 2, 1] },
      { ...evidence, answers: ['1', 2, 0, 3, 2, 0] },
    ]) {
      expect(validBinaryEvidence(invalid)).toBe(false);
    }
  });
});
