'use client';

import type { FlashcardResponse } from '@studyvault/types';
import { AiHttpError, listFlashcards, type GetToken } from './ai-client';
import {
  cacheFlashcardDeck,
  getCachedFlashcardDeck,
  getMostRecentCachedFlashcardDeck,
  type CachedFlashcardDeck,
} from './offline-reviews';

export type FlashcardDeckLoad = {
  cards: FlashcardResponse[];
  deckId: string | null;
  source: 'server' | 'offline';
  cachedAt: number | null;
};

export class FlashcardDeckRequestStaleError extends Error {
  constructor() {
    super('The active account or source changed during the deck request.');
    this.name = 'FlashcardDeckRequestStaleError';
  }
}

function mayUseOfflineCopy(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof AiHttpError && error.status >= 500 && error.status <= 599;
}

/**
 * Refresh one owner/source/deck snapshot online; only transient transport or
 * server failures may fall back. Auth, not-found and validation errors remain
 * visible and never reveal private cards from the local database.
 */
export async function loadFlashcardDeck(
  getToken: GetToken,
  ownerId: string,
  documentId: string,
  deckId: string | null,
  isCurrentOwnerAndSource: () => boolean = () => true,
): Promise<FlashcardDeckLoad> {
  if (!ownerId.trim() || !isCurrentOwnerAndSource()) throw new FlashcardDeckRequestStaleError();
  const token = await getToken();
  if (!isCurrentOwnerAndSource()) throw new FlashcardDeckRequestStaleError();
  if (!token) throw new AiHttpError(401, 'Sign in to view saved flashcards.');
  const scopedToken = async () => token;

  try {
    const cards = await listFlashcards(scopedToken, documentId, deckId ?? undefined);
    if (!isCurrentOwnerAndSource()) throw new FlashcardDeckRequestStaleError();
    let cachedAt: number | null = null;
    try {
      if (!isCurrentOwnerAndSource()) throw new FlashcardDeckRequestStaleError();
      const saved = await cacheFlashcardDeck(ownerId, documentId, deckId, cards);
      cachedAt = saved.cachedAt;
    } catch (error) {
      if (error instanceof FlashcardDeckRequestStaleError) throw error;
      // Storage quota/private-mode failures must not hide a valid online deck.
      console.warn('Offline deck cache write skipped:', error instanceof Error ? error.name : 'UnknownError');
    }
    if (!isCurrentOwnerAndSource()) throw new FlashcardDeckRequestStaleError();
    return { cards, deckId, source: 'server', cachedAt };
  } catch (error) {
    if (error instanceof FlashcardDeckRequestStaleError || !isCurrentOwnerAndSource()) {
      throw new FlashcardDeckRequestStaleError();
    }
    if (!mayUseOfflineCopy(error)) throw error;
    const cached: CachedFlashcardDeck | null = deckId === null
      ? (await getCachedFlashcardDeck(ownerId, documentId, null))
        ?? (await getMostRecentCachedFlashcardDeck(ownerId, documentId))
      : await getCachedFlashcardDeck(ownerId, documentId, deckId);
    if (!cached) throw error;
    if (!isCurrentOwnerAndSource()) throw new FlashcardDeckRequestStaleError();
    return {
      cards: cached.cards,
      deckId: cached.deckId,
      source: 'offline',
      cachedAt: cached.cachedAt,
    };
  }
}
