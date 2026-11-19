'use client';

import Dexie, { type Table } from 'dexie';
import {
  FlashcardListResponseSchema,
  ReviewRequestSchema,
  type FlashcardResponse,
} from '@studyvault/types';
import { z } from 'zod';

/**
 * Offline review log (task 3.4).
 *
 * Reviews are QUEUED locally, never applied locally: the server stays
 * authoritative for SM-2 scheduling. The queue is append-only keyed by a
 * client-generated `uuid`, and sync posts it with that id — the server's
 * reviews table ignores the duplicate, so reconnecting twice can never record a
 * review effect twice. Delivery is retryable, not exactly once. Ownerless v1
 * rows remain quarantined: assigning them to the next account would leak data.
 */

export interface QueuedReview {
  /** Client-generated idempotency key. */
  uuid: string;
  ownerId: string;
  cardId: string;
  grade: number;
  reviewedAt: string; // ISO
  synced: 0 | 1;
}

/** A whole-deck snapshot is owned by the account that fetched it. */
export interface CachedFlashcardDeck {
  key: string;
  ownerId: string;
  documentId: string;
  deckId: string | null;
  cards: FlashcardResponse[];
  cachedAt: number;
  lastAccessedAt: number;
}

export const MAX_OFFLINE_DECK_CARDS = 100;
export const MAX_OFFLINE_DECKS_PER_OWNER = 12;
const MAX_OFFLINE_DECK_JSON_CHARS = 1_000_000;
const MAX_OFFLINE_CARD_TEXT_LENGTH = 4_000;
const OwnerScopeSchema = z.string().trim().min(1).max(255);
const CachedFlashcardDeckSchema = z.strictObject({
  key: z.string().min(1),
  ownerId: OwnerScopeSchema,
  documentId: z.uuid(),
  deckId: z.uuid().nullable(),
  cards: FlashcardListResponseSchema.max(MAX_OFFLINE_DECK_CARDS),
  cachedAt: z.number().int().positive(),
  lastAccessedAt: z.number().int().positive(),
});

export class StudyVaultDb extends Dexie {
  reviews!: Table<QueuedReview, string>;
  cachedDecks!: Table<CachedFlashcardDeck, string>;

  constructor() {
    super('studyvault');
    this.version(1).stores({ reviews: 'uuid, cardId, synced' });
    this.version(2).stores({ reviews: 'uuid, ownerId, [ownerId+synced], cardId, synced' });
    // Adding a separate store preserves existing queued review rows and keeps
    // legacy ownerless v1 rows quarantined by the unchanged queue reader.
    this.version(3).stores({
      reviews: 'uuid, ownerId, [ownerId+synced], cardId, synced',
      cachedDecks: '&key, ownerId, [ownerId+documentId], [ownerId+lastAccessedAt]',
    });
  }
}

let db: StudyVaultDb | undefined;

/** Lazily constructed so this module can be imported during SSR/build. */
export function getDb(): StudyVaultDb {
  db ??= new StudyVaultDb();
  return db;
}

function ownerScope(ownerId: string): void {
  OwnerScopeSchema.parse(ownerId);
}

function deckCacheKey(ownerId: string, documentId: string, deckId: string | null): string {
  return JSON.stringify([ownerId, documentId, deckId]);
}

function validatedDeck(
  ownerId: string,
  documentId: string,
  deckId: string | null,
  cards: readonly FlashcardResponse[],
): FlashcardResponse[] {
  ownerScope(ownerId);
  z.uuid().parse(documentId);
  if (deckId !== null) z.uuid().parse(deckId);
  if (cards.length > MAX_OFFLINE_DECK_CARDS) {
    throw new RangeError(`Offline deck limit is ${MAX_OFFLINE_DECK_CARDS} cards.`);
  }
  const parsedCards = FlashcardListResponseSchema.parse(cards);
  const ids = new Set<string>();
  for (const card of parsedCards) {
    if (card.document_id && card.document_id !== documentId) {
      throw new Error('Offline card belongs to another document.');
    }
    if (card.front.length > MAX_OFFLINE_CARD_TEXT_LENGTH || card.back.length > MAX_OFFLINE_CARD_TEXT_LENGTH) {
      throw new RangeError('Offline card text exceeds the storage limit.');
    }
    if (ids.has(card.id)) throw new Error('Offline deck contains duplicate cards.');
    ids.add(card.id);
  }
  return parsedCards;
}

/** Save a server-validated full deck snapshot, partitioned by owner/source/deck. */
export async function cacheFlashcardDeck(
  ownerId: string,
  documentId: string,
  deckId: string | null,
  cards: readonly FlashcardResponse[],
): Promise<CachedFlashcardDeck> {
  const normalizedOwner = OwnerScopeSchema.parse(ownerId);
  const parsedCards = validatedDeck(normalizedOwner, documentId, deckId, cards);
  let row: CachedFlashcardDeck = {
    key: deckCacheKey(normalizedOwner, documentId, deckId),
    ownerId: normalizedOwner,
    documentId,
    deckId,
    cards: parsedCards,
    cachedAt: Date.now(),
    lastAccessedAt: Date.now(),
  };
  if (JSON.stringify(row).length > MAX_OFFLINE_DECK_JSON_CHARS) {
    throw new RangeError('Offline deck exceeds the storage limit.');
  }

  const db = getDb();
  await db.transaction('rw', db.cachedDecks, async () => {
    const existing = await db.cachedDecks.where('ownerId').equals(normalizedOwner).toArray();
    const mostRecent = existing.reduce((latest, item) => Math.max(latest, item.lastAccessedAt), 0);
    // IndexedDB timestamps need a deterministic order when two successful fetches
    // share one millisecond; the later write becomes the latest offline deck.
    const monotonicNow = Math.max(Date.now(), mostRecent + 1);
    row = { ...row, cachedAt: monotonicNow, lastAccessedAt: monotonicNow };
    await db.cachedDecks.put(row);
    const ownerRows = await db.cachedDecks.where('ownerId').equals(normalizedOwner).sortBy('lastAccessedAt');
    const excess = ownerRows.slice(0, Math.max(0, ownerRows.length - MAX_OFFLINE_DECKS_PER_OWNER));
    if (excess.length) await db.cachedDecks.bulkDelete(excess.map((entry) => entry.key));
  });
  return row;
}

/** Return only a fully validated exact owner/source/deck match. */
export async function getCachedFlashcardDeck(
  ownerId: string,
  documentId: string,
  deckId: string | null,
): Promise<CachedFlashcardDeck | null> {
  const normalizedOwner = OwnerScopeSchema.parse(ownerId);
  z.uuid().parse(documentId);
  if (deckId !== null) z.uuid().parse(deckId);
  const key = deckCacheKey(normalizedOwner, documentId, deckId);
  const db = getDb();
  return db.transaction('rw', db.cachedDecks, async () => {
    const row = await db.cachedDecks.get(key);
    if (!row || row.key !== key || row.ownerId !== normalizedOwner || row.documentId !== documentId || row.deckId !== deckId) {
      return null;
    }
    const parsed = CachedFlashcardDeckSchema.safeParse(row);
    if (!parsed.success) {
      await db.cachedDecks.delete(key);
      return null;
    }
    const ownerRows = await db.cachedDecks.where('ownerId').equals(normalizedOwner).toArray();
    const latestAccess = ownerRows.reduce((latest, item) => Math.max(latest, item.lastAccessedAt), 0);
    const accessed = {
      ...parsed.data,
      lastAccessedAt: Math.max(Date.now(), latestAccess + 1),
    };
    await db.cachedDecks.put(accessed);
    return accessed;
  });
}

/** Use the most recently used valid deck only when no deck has been selected. */
export async function getMostRecentCachedFlashcardDeck(
  ownerId: string,
  documentId: string,
): Promise<CachedFlashcardDeck | null> {
  const normalizedOwner = OwnerScopeSchema.parse(ownerId);
  z.uuid().parse(documentId);
  const rows = await getDb().cachedDecks
    .where('[ownerId+documentId]')
    .equals([normalizedOwner, documentId])
    .toArray();
  const candidates = rows
    .map((row) => CachedFlashcardDeckSchema.safeParse(row))
    .filter((result) => result.success && result.data.ownerId === normalizedOwner && result.data.documentId === documentId)
    .map((result) => result.data)
    .sort((left, right) => (right?.lastAccessedAt ?? 0) - (left?.lastAccessedAt ?? 0));
  const latest = candidates[0];
  return latest ? getCachedFlashcardDeck(normalizedOwner, documentId, latest.deckId) : null;
}

export async function queueReview(ownerId: string, cardId: string, grade: number): Promise<QueuedReview> {
  ownerScope(ownerId);
  z.uuid().parse(cardId);
  const uuid = crypto.randomUUID();
  ReviewRequestSchema.parse({ grade, review_id: uuid });
  const row: QueuedReview = {
    uuid,
    ownerId,
    cardId,
    grade,
    reviewedAt: new Date().toISOString(),
    synced: 0,
  };
  await getDb().reviews.add(row);
  return row;
}

export async function pendingCount(ownerId: string): Promise<number> {
  ownerScope(ownerId);
  return getDb().reviews.where('[ownerId+synced]').equals([ownerId, 0]).count();
}

const syncing = new Map<string, Promise<unknown>>();

/**
 * Push queued reviews to the server. Safe to call repeatedly and after every
 * reconnect: each row is marked synced only after the server accepted it, and
 * the server de-duplicates by `uuid`.
 */
export async function syncReviews(
  ownerId: string,
  send: (row: QueuedReview) => Promise<boolean>,
  isCurrentAccount: () => boolean,
): Promise<{ sent: number; failed: number }> {
  ownerScope(ownerId);
  // Serialize reconnect/grade events within this tab. Cross-tab retries keep
  // the same uuid and use the server's atomic review idempotency contract.
  const previous = syncing.get(ownerId) ?? Promise.resolve();
  const run = () => syncOwnedReviews(ownerId, send, isCurrentAccount);
  // Each original caller observes its own rejection; one failed pass must not
  // poison subsequent reconnects.
  const result = previous.then(run, run);
  syncing.set(ownerId, result);
  try {
    return await result;
  } finally {
    if (syncing.get(ownerId) === result) syncing.delete(ownerId);
  }
}

async function syncOwnedReviews(
  ownerId: string,
  send: (row: QueuedReview) => Promise<boolean>,
  isCurrentAccount: () => boolean,
): Promise<{ sent: number; failed: number }> {
  if (!isCurrentAccount()) return { sent: 0, failed: 0 };
  const pending = await getDb().reviews.where('[ownerId+synced]').equals([ownerId, 0]).toArray();
  let sent = 0;
  let failed = 0;
  for (const row of pending) {
    if (!isCurrentAccount()) break;
    if (row.ownerId !== ownerId) throw new Error('Offline review owner mismatch');
    try {
      const ok = await send(row);
      if (!isCurrentAccount()) break;
      if (ok) {
        await getDb().reviews.where('uuid').equals(row.uuid).and((saved) => saved.ownerId === ownerId).modify({ synced: 1 });
        sent += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      console.warn('Offline review sync deferred:', error instanceof Error ? error.name : 'UnknownError');
      failed += 1; // offline / transient: stays queued for the next attempt
    }
  }
  return { sent, failed };
}
