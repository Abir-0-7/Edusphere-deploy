import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, pendingCount, queueReview, syncReviews } from '../src/lib/offline-reviews';

const cardId = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await getDb().delete();
  await getDb().open();
});

afterEach(async () => {
  await getDb().delete();
  vi.restoreAllMocks();
});

describe('account-scoped offline review queue', () => {
  it('keeps A private when B signs in, then syncs A once across reconnects and a DB reopen', async () => {
    const alice = await queueReview('alice', cardId, 4);
    const bob = await queueReview('bob', cardId, 3);
    expect(await pendingCount('alice')).toBe(1);
    expect(await pendingCount('bob')).toBe(1);
    const sent: string[] = [];
    const send = vi.fn(async (row) => { sent.push(row.uuid); return true; });
    await syncReviews('bob', send, () => true);
    expect(sent).toEqual([bob.uuid]);
    expect(await pendingCount('alice')).toBe(1);
    getDb().close();
    await getDb().open();
    await syncReviews('alice', send, () => true);
    await syncReviews('alice', send, () => true);
    expect(sent).toEqual([bob.uuid, alice.uuid]);
    expect(await pendingCount('alice')).toBe(0);
  });

  it('quarantines ownerless v1 records instead of assigning them to the next account', async () => {
    await getDb().delete();
    const legacy = new Dexie('studyvault');
    legacy.version(1).stores({ reviews: 'uuid, cardId, synced' });
    await legacy.table('reviews').add({ uuid: crypto.randomUUID(), cardId, grade: 4, synced: 0 });
    legacy.close();
    await getDb().open();
    expect(await getDb().reviews.count()).toBe(1);
    expect(await pendingCount('alice')).toBe(0);
    expect(await pendingCount('bob')).toBe(0);
    const send = vi.fn(async () => true);
    await syncReviews('bob', send, () => true);
    expect(send).not.toHaveBeenCalled();
  });

  it('serializes simultaneous reconnects so one accepted review is sent once within the tab', async () => {
    await queueReview('alice', cardId, 4);
    const send = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return true;
    });
    const results = await Promise.all(Array.from({ length: 8 }, () => syncReviews('alice', send, () => true)));
    expect(send).toHaveBeenCalledOnce();
    expect(results.reduce((sum, value) => sum + value.sent, 0)).toBe(1);
  });

  it('reuses the original UUID after a lost acknowledgement, preserving one server idempotency key', async () => {
    const row = await queueReview('alice', cardId, 4);
    const effects = new Set<string>();
    const ids: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await syncReviews('alice', async (review) => {
      effects.add(review.uuid);
      ids.push(review.uuid);
      throw new Error('Connection lost after server accepted the review');
    }, () => true);
    expect(first.failed).toBe(1);
    expect(await pendingCount('alice')).toBe(1);
    await syncReviews('alice', async (review) => {
      effects.add(review.uuid);
      ids.push(review.uuid);
      return true;
    }, () => true);
    expect(ids).toEqual([row.uuid, row.uuid]);
    expect(effects.size).toBe(1);
    expect(await pendingCount('alice')).toBe(0);
  });

  it('stops an old account pass after switching, and never starts a cancelled pass', async () => {
    await queueReview('alice', cardId, 4);
    await queueReview('alice', cardId, 3);
    let account = 'alice';
    const send = vi.fn(async () => { account = 'bob'; return true; });
    await syncReviews('alice', send, () => account === 'alice');
    expect(send).toHaveBeenCalledOnce();
    expect(await pendingCount('alice')).toBe(2);
    await syncReviews('alice', send, () => account === 'alice');
    expect(send).toHaveBeenCalledOnce();
    expect(await pendingCount('bob')).toBe(0);
  });

  it('validates review boundaries before writing and requires an explicit account', async () => {
    await expect(queueReview('', cardId, 4)).rejects.toThrow();
    await expect(queueReview('alice', 'not-a-card-id', 4)).rejects.toThrow();
    await expect(queueReview('alice', cardId, 6)).rejects.toThrow();
    await expect(pendingCount('')).rejects.toThrow();
    expect(await getDb().reviews.count()).toBe(0);
  });
});
