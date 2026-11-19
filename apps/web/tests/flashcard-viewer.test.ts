import { afterEach, describe, expect, it, vi } from 'vitest';
import { explainFlashcard } from '../src/lib/ai-client';
import { flashcardViewerSessionKey, readFlashcardViewerSession } from '../src/components/flashcard-viewer';

const cardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const accountId = 'user-one';
const getToken = vi.fn(async () => 'study-token');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('casual flashcard viewer contracts', () => {
  it('keys resumed sessions by account, document, and deck', () => {
    expect(flashcardViewerSessionKey(accountId, documentId, null))
      .not.toBe(flashcardViewerSessionKey('user-two', documentId, null));
    expect(flashcardViewerSessionKey(accountId, documentId, null))
      .not.toBe(flashcardViewerSessionKey(accountId, documentId, cardId));
  });

  it('rejects malformed resume state and removes cards outside the selected deck', () => {
    expect(readFlashcardViewerSession('{bad json', [cardId])).toBeNull();
    const saved = readFlashcardViewerSession(JSON.stringify({
      version: 1,
      orderIds: [cardId, documentId],
      index: 1,
      missedIds: [documentId],
      practiceMissed: true,
      revealed: false,
    }), [cardId]);
    expect(saved).toEqual({
      version: 1,
      orderIds: [cardId],
      index: 0,
      missedIds: [],
      practiceMissed: false,
      revealed: false,
    });
  });

  it('requests explanation from the authorized card route without submitting a review', async () => {
    const payload = {
      card_id: cardId,
      available: true,
      explanation: 'The source describes this relationship.',
      source_quote: 'This relationship is described here.',
      source_excerpt: 'This relationship is described here.',
      page: 4,
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);

    await expect(explainFlashcard(getToken, cardId)).resolves.toEqual(payload);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain(`/api/flashcards/${cardId}/explain`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain('/review');
  });

  it('surfaces missing source evidence as a recoverable explanation error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(
      JSON.stringify({ error: { code: 'invalid_input', message: 'Source evidence is no longer available.' } }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetch);

    await expect(explainFlashcard(getToken, cardId)).rejects.toThrow('Source evidence is no longer available.');
  });
});
