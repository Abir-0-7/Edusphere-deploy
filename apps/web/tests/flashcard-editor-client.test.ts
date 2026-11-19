import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteFlashcard, editFlashcard, reportFlashcard, retireFlashcard } from '../src/lib/ai-client';

const cardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const getToken = vi.fn(async () => 'study-token');
const card = {
  id: cardId,
  front: 'What is photosynthesis?',
  back: 'The process plants use to turn light into chemical energy.',
  ease_factor: 2.5,
  interval_days: 4,
  repetitions: 2,
  due_date: '2026-11-20',
  tags: ['biology'],
  status: 'active',
  needs_review: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('flashcard editing client', () => {
  it('sends validated card edits and parses the server-authoritative card response', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(card));
    vi.stubGlobal('fetch', fetch);

    await expect(editFlashcard(getToken, cardId, {
      front: card.front,
      back: card.back,
      tags: ['biology'],
    })).resolves.toMatchObject({ id: cardId, tags: ['biology'], needs_review: true });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toContain(`/api/flashcards/${cardId}`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ front: card.front, back: card.back, tags: ['biology'] });
  });

  it('posts incorrect-card reports and validates the success receipt', async () => {
    const receipt = {
      card_id: cardId,
      report_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'received',
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(receipt));
    vi.stubGlobal('fetch', fetch);

    await expect(reportFlashcard(getToken, cardId, 'The answer conflicts with the cited source.')).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toContain(`/api/flashcards/${cardId}/report`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'The answer conflicts with the cited source.' });
  });

  it('uses the retire and delete routes with their response contracts', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ ...card, status: 'retired' }))
      .mockResolvedValueOnce(Response.json({ card_id: cardId, deleted: true }));
    vi.stubGlobal('fetch', fetch);

    await expect(retireFlashcard(getToken, cardId)).resolves.toMatchObject({ status: 'retired' });
    await expect(deleteFlashcard(getToken, cardId)).resolves.toBeUndefined();
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'DELETE']);
    expect(fetch.mock.calls[0]?.[0]).toContain(`/api/flashcards/${cardId}/retire`);
    expect(fetch.mock.calls[1]?.[0]).toContain(`/api/flashcards/${cardId}`);
  });

  it('rejects invalid edits and empty report reasons before making a request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);

    await expect(editFlashcard(getToken, cardId, { tags: ['repeat', 'repeat'] })).rejects.toThrow();
    await expect(reportFlashcard(getToken, cardId, '  ')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
