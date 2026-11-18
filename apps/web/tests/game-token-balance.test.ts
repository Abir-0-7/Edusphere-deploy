import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTokenBalance } from '../src/lib/ai-client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Game Vault canonical StudyVault token balance', () => {
  it('reads the persisted ledger balance with the signed-in bearer rather than local game rewards', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_SERVICE_URL', 'https://study-api.test');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ balance: 42 }));
    vi.stubGlobal('fetch', fetcher);
    const getToken = vi.fn().mockResolvedValue('learner-session');
    expect(await getTokenBalance(getToken)).toEqual({ balance: 42 });
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://study-api.test/api/tokens/balance');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer learner-session');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(init?.cache).toBe('no-store');
  });

  it('refetches after a committed reward and accepts an authoritative zero balance', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ balance: 0 }))
      .mockResolvedValueOnce(Response.json({ balance: 5 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await getTokenBalance(async () => 'token')).toEqual({ balance: 0 });
    expect(await getTokenBalance(async () => 'token')).toEqual({ balance: 5 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([{ balance: -1 }, { balance: 1.5 }, { balance: '5' }, { tokens_awarded: 5 }])(
    'rejects invalid balance payload %j',
    async (body) => {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));
      await expect(getTokenBalance(async () => 'token')).rejects.toThrow('invalid service response');
    },
  );

  it('surfaces an outage so the balance can be retried without resetting it to zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'internal', message: 'Token ledger is temporarily unavailable' } },
            { status: 503 },
          ),
        ),
    );
    await expect(getTokenBalance(async () => 'token')).rejects.toThrow(
      'Token ledger is temporarily unavailable',
    );
  });

  it('makes no request when Clerk cannot obtain a session token', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      getTokenBalance(async () => {
        throw new Error('Clerk unavailable');
      }),
    ).rejects.toThrow('Clerk unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
