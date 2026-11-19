import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_OFFLINE_DECK_CARDS,
  MAX_OFFLINE_DECKS_PER_OWNER,
  cacheFlashcardDeck,
  getCachedFlashcardDeck,
  getDb,
  pendingCount,
  queueReview,
  syncReviews,
} from '../src/lib/offline-reviews';
import { AiHttpError } from '../src/lib/ai-client';
import { FlashcardDeckRequestStaleError, loadFlashcardDeck } from '../src/lib/offline-deck-client';
import type { FlashcardResponse } from '@studyvault/types';

const ids = {
  documentA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  documentB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  deckA: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  deckB: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  cardA: '11111111-1111-4111-8111-111111111111',
  cardB: '22222222-2222-4222-8222-222222222222',
};
const ownerA = 'clerk-owner-a';
const ownerB = 'clerk-owner-b';
const getToken = async () => 'valid-session-token';
const card = (id: string, documentId = ids.documentA): FlashcardResponse => ({
  id,
  document_id: documentId,
  front: 'Question',
  back: 'Answer',
  ease_factor: 2.5,
  interval_days: 0,
  repetitions: 0,
  due_date: '2026-11-19',
});

const online = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../src/lib/ai-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/ai-client')>();
  return { ...actual, listFlashcards: online.list };
});

beforeEach(async () => {
  online.list.mockReset();
  await getDb().delete();
  await getDb().open();
});

afterEach(async () => {
  await getDb().delete();
});

describe('owner-scoped offline deck snapshots', () => {
  it('adds a Dexie v3 store without losing v2 account-scoped review rows', async () => {
    await getDb().delete();
    const legacy = new Dexie('studyvault');
    legacy.version(1).stores({ reviews: 'uuid, cardId, synced' });
    legacy.version(2).stores({ reviews: 'uuid, ownerId, [ownerId+synced], cardId, synced' });
    await legacy.table('reviews').add({
      uuid: 'review-a', ownerId: ownerA, cardId: ids.cardA, grade: 4,
      reviewedAt: '2026-11-19T00:00:00.000Z', synced: 0,
    });
    legacy.close();

    await getDb().open();
    expect(await pendingCount(ownerA)).toBe(1);
    expect(await getDb().cachedDecks.count()).toBe(0);
  });

  it('loads only the cached owner/document/deck partition', async () => {
    await cacheFlashcardDeck(ownerA, ids.documentA, ids.deckA, [card(ids.cardA)]);
    await cacheFlashcardDeck(ownerB, ids.documentA, ids.deckA, [card(ids.cardB)]);
    await cacheFlashcardDeck(ownerA, ids.documentB, ids.deckA, [card(ids.cardB, ids.documentB)]);

    expect((await getCachedFlashcardDeck(ownerA, ids.documentA, ids.deckA))?.cards.map((row) => row.id))
      .toEqual([ids.cardA]);
    expect((await getCachedFlashcardDeck(ownerB, ids.documentA, ids.deckA))?.cards.map((row) => row.id))
      .toEqual([ids.cardB]);
    expect(await getCachedFlashcardDeck(ownerA, ids.documentA, ids.deckB)).toBeNull();
    expect(await getCachedFlashcardDeck(ownerA, ids.documentB, ids.deckA)).not.toBeNull();
  });

  it('rejects oversized, duplicate, malformed, and cross-document card snapshots', async () => {
    const tooMany = Array.from({ length: MAX_OFFLINE_DECK_CARDS + 1 }, (_, index) =>
      card('30000000-0000-4000-8000-' + String(index + 1).padStart(12, '0')));
    await expect(cacheFlashcardDeck(ownerA, ids.documentA, ids.deckA, tooMany)).rejects.toThrow('limit');
    await expect(cacheFlashcardDeck(ownerA, ids.documentA, ids.deckA, [card(ids.cardA, ids.documentB)]))
      .rejects.toThrow('another document');
    await expect(cacheFlashcardDeck(ownerA, ids.documentA, ids.deckA, [card(ids.cardA), card(ids.cardA)]))
      .rejects.toThrow('duplicate');
    await expect(cacheFlashcardDeck(ownerA, ids.documentA, ids.deckA, [
      { ...card(ids.cardA), repetitions: -1 } as FlashcardResponse,
    ])).rejects.toThrow();
    expect(await getDb().cachedDecks.count()).toBe(0);
  });

  it('evicts the least-recently-used deck within one owner without touching another owner', async () => {
    const deckIds = Array.from({ length: MAX_OFFLINE_DECKS_PER_OWNER + 1 }, (_, index) =>
      '40000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'));
    for (const deckId of deckIds) {
      await cacheFlashcardDeck(ownerA, ids.documentA, deckId, [card(ids.cardA)]);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await cacheFlashcardDeck(ownerB, ids.documentA, ids.deckB, [card(ids.cardB)]);

    expect(await getDb().cachedDecks.where('ownerId').equals(ownerA).count()).toBe(MAX_OFFLINE_DECKS_PER_OWNER);
    expect(await getCachedFlashcardDeck(ownerA, ids.documentA, deckIds[0]!)).toBeNull();
    expect(await getCachedFlashcardDeck(ownerA, ids.documentA, deckIds.at(-1)!)).not.toBeNull();
    expect(await getCachedFlashcardDeck(ownerB, ids.documentA, ids.deckB)).not.toBeNull();
  });

  it('refreshes online and falls back to a selected/recent cached deck only on transient failures', async () => {
    online.list.mockResolvedValueOnce([card(ids.cardA)]);
    await expect(loadFlashcardDeck(getToken, ownerA, ids.documentA, ids.deckA)).resolves.toMatchObject({
      source: 'server', deckId: ids.deckA, cards: [card(ids.cardA)],
    });

    online.list.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(loadFlashcardDeck(getToken, ownerA, ids.documentA, ids.deckA)).resolves.toMatchObject({
      source: 'offline', deckId: ids.deckA, cards: [card(ids.cardA)],
    });

    online.list.mockResolvedValueOnce([card(ids.cardB)]);
    await loadFlashcardDeck(getToken, ownerA, ids.documentA, ids.deckB);
    online.list.mockRejectedValueOnce(new AiHttpError(503, 'Service unavailable'));
    await expect(loadFlashcardDeck(getToken, ownerA, ids.documentA, null)).resolves.toMatchObject({
      source: 'offline', deckId: ids.deckB, cards: [card(ids.cardB)],
    });
  });

  it.each([401, 403, 404])('never reads private cache after HTTP %i', async (status) => {
    await cacheFlashcardDeck(ownerA, ids.documentA, ids.deckA, [card(ids.cardA)]);
    online.list.mockRejectedValueOnce(new AiHttpError(status, 'Not authorized'));
    await expect(loadFlashcardDeck(getToken, ownerA, ids.documentA, ids.deckA)).rejects.toMatchObject({ status });
  });

  it('never applies a response after the owner or source changed during the request', async () => {
    await cacheFlashcardDeck(ownerA, ids.documentA, ids.deckA, [card(ids.cardA)]);
    let requestIsCurrent = true;
    online.list.mockImplementationOnce(async () => {
      requestIsCurrent = false;
      return [card(ids.cardB)];
    });
    await expect(loadFlashcardDeck(
      getToken, ownerA, ids.documentA, ids.deckA, () => requestIsCurrent,
    )).rejects.toBeInstanceOf(FlashcardDeckRequestStaleError);
    expect(await getCachedFlashcardDeck(ownerA, ids.documentA, ids.deckA)).toMatchObject({
      cards: [card(ids.cardA)],
    });
  });

  it('requires a current authenticated token before consulting local cards', async () => {
    await cacheFlashcardDeck(ownerA, ids.documentA, ids.deckA, [card(ids.cardA)]);
    await expect(loadFlashcardDeck(async () => null, ownerA, ids.documentA, ids.deckA))
      .rejects.toMatchObject({ status: 401 });
  });

  it('syncs scheduled offline reviews repeatedly with one server effect and no account leakage', async () => {
    await cacheFlashcardDeck(ownerA, ids.documentA, ids.deckA, [card(ids.cardA)]);
    const queued = await queueReview(ownerA, ids.cardA, 4);
    const acceptedReviewIds = new Set<string>();
    let scheduledEffects = 0;
    const sync = async (ownerId: string) => syncReviews(ownerId, async (row) => {
      if (!acceptedReviewIds.has(row.uuid)) {
        acceptedReviewIds.add(row.uuid);
        scheduledEffects += 1;
      }
      return true;
    }, () => true);

    await sync(ownerB);
    expect(await pendingCount(ownerA)).toBe(1);
    await sync(ownerA);
    await sync(ownerA);
    expect(queued.uuid).toBe([...acceptedReviewIds][0]);
    expect(scheduledEffects).toBe(1);
    expect(await pendingCount(ownerA)).toBe(0);
    expect(await pendingCount(ownerB)).toBe(0);
  });
});
