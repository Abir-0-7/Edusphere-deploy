import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gameMissionProgress, tokenLedger } from '@studyvault/db';
import { completeMission, contextFor, unlockMission } from '../src/lib/game-vault/server';
import {
  CYBERVERSE_MISSIONS,
  isCyberverseMission,
  validBinaryEvidence,
} from '../src/lib/game-vault/mission-rules';

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  txSelect: vi.fn(),
  execute: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
  set: vi.fn(),
  whereUpdate: vi.fn(),
  readRows: [] as unknown[][],
  transactionRows: [] as unknown[][],
  order: [] as string[],
}));

vi.mock('@/lib/users', () => ({ getUserByClerkId: mocks.user }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ select: mocks.select, transaction: mocks.transaction }) }));

const userId = '11111111-1111-4111-8111-111111111111';
const entitlementId = '22222222-2222-4222-8222-222222222222';
const evidence = { challengeVersion: 'binary-v1', answers: [1, 2, 0, 3, 2, 0] };
const progressRow = {
  id: entitlementId,
  userId,
  gameId: 'cyberverse',
  missionId: 'binary_city',
  completedAt: null as Date | null,
  xpAwarded: 0,
  achievements: [] as string[],
};

function resultQuery(rows: unknown[]) {
  const result = Object.assign(Promise.resolve(rows), { limit: vi.fn().mockResolvedValue(rows) });
  return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(result) }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readRows = [];
  mocks.transactionRows = [];
  mocks.order = [];
  mocks.user.mockResolvedValue({ id: userId, email: 'student@example.test' });
  mocks.select.mockImplementation(() => resultQuery(mocks.readRows.shift() ?? []));
  mocks.txSelect.mockImplementation(() => {
    mocks.order.push('read');
    return resultQuery(mocks.transactionRows.shift() ?? []);
  });
  mocks.execute.mockImplementation(async () => {
    mocks.order.push('lock');
    return [];
  });
  mocks.values.mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: entitlementId }]) });
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.whereUpdate.mockResolvedValue([]);
  mocks.set.mockReturnValue({ where: mocks.whereUpdate });
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      select: mocks.txSelect,
      execute: mocks.execute,
      insert: mocks.insert,
      update: mocks.update,
    }),
  );
});

describe('authoritative mission rules', () => {
  it('defines exactly the six individually priced missions', () => {
    expect(Object.values(CYBERVERSE_MISSIONS).map((mission) => mission.cost)).toEqual([
      5, 10, 15, 20, 25, 30,
    ]);
    expect(isCyberverseMission('binary_city')).toBe(true);
    expect(isCyberverseMission('unknown')).toBe(false);
    expect(isCyberverseMission('__proto__')).toBe(false);
    expect(isCyberverseMission('constructor')).toBe(false);
  });
  it('requires the exact Binary City evidence version and all six correct answers', () => {
    expect(validBinaryEvidence(evidence)).toBe(true);
    for (const invalid of [
      null,
      {},
      { answers: evidence.answers },
      { ...evidence, answers: [] },
      { ...evidence, answers: [1, 2, 0, 3, 2, 1] },
      { ...evidence, answers: ['1', 2, 0, 3, 2, 0] },
      { ...evidence, challengeVersion: 'other' },
    ])
      expect(validBinaryEvidence(invalid)).toBe(false);
  });
});

describe('existing ledger and scoped progression', () => {
  it('loads the existing ledger balance and unique achievement state', async () => {
    mocks.readRows = [
      [{ balance: '95' }],
      [
        {
          ...progressRow,
          completedAt: new Date(),
          xpAwarded: 100,
          achievements: ['first_transmission', 'first_transmission'],
        },
      ],
    ];
    const state = await contextFor('clerk_owner');
    expect(state).toMatchObject({
      mode: 'production',
      tokens: 95,
      xp: 100,
      unlocked: ['binary_city'],
      completed: ['binary_city'],
      achievements: ['first_transmission'],
      student: { id: userId, displayName: 'student' },
    });
    expect(mocks.user).toHaveBeenCalledWith('clerk_owner');
  });
  it('does not query progress for a missing synced user', async () => {
    mocks.user.mockResolvedValue(null);
    expect(await contextFor('missing')).toBeNull();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(await unlockMission('missing', 'binary_city')).toEqual({ error: 'not_found' });
  });
  it('locks the existing user before balance checks and atomically inserts entitlement plus debit', async () => {
    mocks.transactionRows = [[], [{ value: 100 }]];
    mocks.readRows = [[{ balance: 95 }], [progressRow]];
    const result = await unlockMission('clerk_owner', 'binary_city');
    expect(result.state?.tokens).toBe(95);
    expect(mocks.order).toEqual(['lock', 'read', 'read']);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenNthCalledWith(1, gameMissionProgress);
    expect(mocks.insert).toHaveBeenNthCalledWith(2, tokenLedger);
    expect(mocks.values).toHaveBeenNthCalledWith(1, {
      userId,
      gameId: 'cyberverse',
      missionId: 'binary_city',
    });
    expect(mocks.values).toHaveBeenNthCalledWith(2, {
      userId,
      amount: -5,
      reason: 'game_unlock:cyberverse:binary_city',
      refId: entitlementId,
    });
  });
  it('performs zero writes on insufficient balance', async () => {
    mocks.transactionRows = [[], [{ value: 4 }]];
    expect(await unlockMission('clerk_owner', 'binary_city')).toEqual({ error: 'insufficient_tokens' });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not deduct again for an existing permanent entitlement', async () => {
    mocks.transactionRows = [[progressRow]];
    mocks.readRows = [[{ balance: 95 }], [progressRow]];
    expect((await unlockMission('clerk_owner', 'binary_city')).state?.unlocked).toEqual(['binary_city']);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('rejects unknown missions before starting a database transaction', async () => {
    expect(await unlockMission('clerk_owner', 'constructor')).toEqual({ error: 'mission_not_found' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('propagates a failed transaction instead of returning an uncommitted success', async () => {
    mocks.transaction.mockRejectedValue(new Error('database unavailable'));
    await expect(unlockMission('clerk_owner', 'binary_city')).rejects.toThrow('database unavailable');
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it('rejects wrong answers and preview completion without changing either ledger or progress', async () => {
    expect(
      await completeMission('clerk_owner', 'binary_city', { ...evidence, answers: [0, 0, 0, 0, 0, 0] }),
    ).toEqual({ error: 'completion_rejected' });
    expect(await completeMission('clerk_owner', 'code_district', evidence)).toEqual({
      error: 'completion_rejected',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('requires a paid entitlement before completion', async () => {
    mocks.transactionRows = [[]];
    expect(await completeMission('clerk_owner', 'binary_city', evidence)).toEqual({
      error: 'mission_locked',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('awards server-defined XP and achievement once without touching token ledger', async () => {
    mocks.transactionRows = [[progressRow]];
    mocks.readRows = [
      [{ balance: 95 }],
      [{ ...progressRow, completedAt: new Date(), xpAwarded: 100, achievements: ['first_transmission'] }],
    ];
    const result = await completeMission('clerk_owner', 'binary_city', evidence);
    expect(result.state?.xp).toBe(100);
    expect(mocks.set).toHaveBeenCalledWith({
      completedAt: expect.any(Date),
      xpAwarded: 100,
      achievements: ['first_transmission'],
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('replay returns persisted rewards without another write', async () => {
    const row = {
      ...progressRow,
      completedAt: new Date(),
      xpAwarded: 100,
      achievements: ['first_transmission'],
    };
    mocks.transactionRows = [[row]];
    mocks.readRows = [[{ balance: 95 }], [row]];
    const result = await completeMission('clerk_owner', 'binary_city', evidence);
    expect(result.state).toMatchObject({ tokens: 95, xp: 100, achievements: ['first_transmission'] });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
