'use client';

import Dexie, { type Table } from 'dexie';

/**
 * Offline review log (task 3.4).
 *
 * Reviews are QUEUED locally, never applied locally: the server stays
 * authoritative for SM-2 scheduling. The queue is append-only keyed by a
 * client-generated `uuid`, and sync posts it with that id — the server's
 * reviews table ignores the duplicate, so reconnecting twice can never record a
 * review twice. Conflict rule: server wins, append-only, exactly-once delivery.
 */

export interface QueuedReview {
  /** Client-generated idempotency key. */
  uuid: string;
  cardId: string;
  grade: number;
  reviewedAt: string; // ISO
  synced: 0 | 1;
}

class StudyVaultDb extends Dexie {
  reviews!: Table<QueuedReview, string>;

  constructor() {
    super('studyvault');
    this.version(1).stores({ reviews: 'uuid, cardId, synced' });
  }
}

let db: StudyVaultDb | undefined;

/** Lazily constructed so this module can be imported during SSR/build. */
export function getDb(): StudyVaultDb {
  db ??= new StudyVaultDb();
  return db;
}

export async function queueReview(cardId: string, grade: number): Promise<QueuedReview> {
  const row: QueuedReview = {
    uuid: crypto.randomUUID(),
    cardId,
    grade,
    reviewedAt: new Date().toISOString(),
    synced: 0,
  };
  await getDb().reviews.add(row);
  return row;
}

export async function pendingCount(): Promise<number> {
  return getDb().reviews.where('synced').equals(0).count();
}

/**
 * Push queued reviews to the server. Safe to call repeatedly and after every
 * reconnect: each row is marked synced only after the server accepted it, and
 * the server de-duplicates by `uuid`.
 */
export async function syncReviews(
  send: (row: QueuedReview) => Promise<boolean>,
): Promise<{ sent: number; failed: number }> {
  const pending = await getDb().reviews.where('synced').equals(0).toArray();
  let sent = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      const ok = await send(row);
      if (ok) {
        await getDb().reviews.update(row.uuid, { synced: 1 });
        sent += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1; // offline / transient: stays queued for the next attempt
    }
  }
  return { sent, failed };
}
