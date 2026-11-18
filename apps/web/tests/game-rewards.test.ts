import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../src/app/api/games/rewards/route';

const mocks = vi.hoisted(() => ({
  owner: 'alice' as string | null,
  rows: new Map<string, { amount: number }>(),
  insert: vi.fn(),
  conflict: vi.fn(),
}));
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: mocks.owner }) }));
vi.mock('../src/lib/users', () => ({ getUserByClerkId: async (id: string) => ({ id }) }));
vi.mock('../src/lib/db', () => ({ getDb: () => ({ insert: mocks.insert }) }));

const sorting = {
  game_id: 'SortingRace',
  actions: [
    { type: 'swap', left: 0, right: 1 },
    { type: 'swap', left: 1, right: 3 },
  ],
};
function request(body: unknown) {
  return new Request('https://study.test/api/games/rewards', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  mocks.owner = 'alice';
  mocks.rows.clear();
  vi.clearAllMocks();
  mocks.insert.mockImplementation(() => ({
    values: (entry: { userId: string; reason: string; refId: string; amount: number }) => ({
      onConflictDoNothing: () => {
        mocks.conflict();
        return {
          returning: async () => {
            const key = `${entry.reason}:${entry.refId}`;
            if (mocks.rows.has(key)) return [];
            mocks.rows.set(key, { amount: entry.amount });
            return [{ amount: entry.amount }];
          },
        };
      },
    }),
  }));
});

describe('server verified game rewards', () => {
  it('derives amount from replay and awards one effect under concurrent/repeated completion', async () => {
    const replies = await Promise.all(
      Array.from({ length: 12 }, () => POST(request({ ...sorting, score: 999999, amount: 999 }))),
    );
    const payloads = await Promise.all(replies.map((reply) => reply.json()));
    expect(payloads.filter((body) => !body.idempotent)).toHaveLength(1);
    expect(payloads.reduce((sum, body) => sum + body.tokens_awarded, 0)).toBe(4);
    expect(mocks.rows.size).toBe(1);
    expect(mocks.conflict).toHaveBeenCalledTimes(12);
    expect((await (await POST(request(sorting))).json()).tokens_awarded).toBe(0);
  });
  it('keeps daily rewards separate for two authenticated owners', async () => {
    await POST(request(sorting));
    mocks.owner = 'bob';
    await POST(request(sorting));
    expect(mocks.rows.size).toBe(2);
  });
  it('rejects unfinished/fabricated games and missing authentication before any ledger insert', async () => {
    expect(
      (await POST(request({ game_id: 'SortingRace', actions: [{ type: 'swap', left: 0, right: 2 }] })))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            game_id: 'FlashcardTowerDefense',
            actions: [
              { type: 'spawn', lane: 0, hp: 1 },
              { type: 'answer', enemyId: 1, answer: true },
            ],
          }),
        )
      ).status,
    ).toBe(400);
    mocks.owner = null;
    expect((await POST(request(sorting))).status).toBe(401);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('requires five timed correct tower answers; one kill cannot claim a win', async () => {
    const actions = Array.from({ length: 5 }, (_, index) => [
      { type: 'tick', steps: 120 },
      { type: 'answer', enemyId: index + 1, answer: [true, false, true, false][index % 4] },
    ]).flat();
    expect(
      (await POST(request({ game_id: 'FlashcardTowerDefense', actions: actions.slice(0, 2) }))).status,
    ).toBe(400);
    const reply = await POST(request({ game_id: 'FlashcardTowerDefense', actions }));
    expect(reply.status).toBe(201);
    expect(await reply.json()).toEqual({ tokens_awarded: 2, idempotent: false });
  });
});
