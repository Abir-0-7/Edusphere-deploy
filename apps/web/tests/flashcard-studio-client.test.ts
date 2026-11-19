import { afterEach, describe, expect, it, vi } from 'vitest';
import { listFlashcards } from '../src/lib/ai-client';
import { exportStudioDeckCsv, gradeFlashcardQuiz, startFlashcardQuiz } from '../src/lib/flashcard-studio-client';

const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deckId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const getToken = vi.fn(async () => 'study-token');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('flashcard deck selection', () => {
  it('encodes an optional deck ID into the existing document flashcard listing request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetch);

    await expect(listFlashcards(getToken, documentId, deckId)).resolves.toEqual([]);
    expect(fetch.mock.calls[0]?.[0]).toContain(`/api/documents/${documentId}/flashcards?deck_id=${deckId}`);
  });

  it('keeps the unfiltered legacy listing when there is no selected deck', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetch);

    await expect(listFlashcards(getToken, documentId)).resolves.toEqual([]);
    expect(fetch.mock.calls[0]?.[0]).toContain(`/api/documents/${documentId}/flashcards`);
    expect(fetch.mock.calls[0]?.[0]).not.toContain('deck_id=');
  });
});

describe('source quiz and CSV client', () => {
  it('starts and grades a source quiz through the shared response contracts', async () => {
    const session = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      document_id: documentId,
      deck_id: deckId,
      questions: [{
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        prompt: 'What is the source fact?',
        choices: [
          { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', text: 'The source fact.' },
          { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', text: 'A distractor.' },
        ],
      }],
    };
    const result = {
      session_id: session.id,
      answered: 1,
      correct: 1,
      total: 1,
      percent: 100,
      feedback: [{
        question_id: session.questions[0]!.id,
        answered: true,
        correct: true,
        source_quote: 'The source fact.',
        page: 3,
      }],
    };
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(result));
    vi.stubGlobal('fetch', fetch);

    await expect(startFlashcardQuiz(getToken, documentId, { deck_id: deckId, count: 1 })).resolves.toEqual(session);
    await expect(gradeFlashcardQuiz(getToken, session.id, {
      answers: [{ question_id: session.questions[0]!.id, choice_id: session.questions[0]!.choices[0]!.id }],
    })).resolves.toEqual(result);
    expect(fetch.mock.calls[0]?.[0]).toContain(`/api/documents/${documentId}/flashcard-quizzes`);
    expect(fetch.mock.calls[1]?.[0]).toContain(`/api/flashcard-quizzes/${session.id}/grade`);
  });

  it('returns CSV blobs without trying to parse them as JSON', async () => {
    const csv = "front,back\r\n'=1,Answer\r\n";
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(csv, {
      headers: { 'content-type': 'text/csv' },
    }));
    vi.stubGlobal('fetch', fetch);
    const blob = await exportStudioDeckCsv(getToken, documentId, deckId);
    await expect(blob.text()).resolves.toContain("'=1");
    expect(fetch.mock.calls[0]?.[0]).toContain(`/api/documents/${documentId}/flashcard-decks/${deckId}/export.csv`);
  });

  it('rejects a malformed quiz response before rendering it', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async () => Response.json({ questions: [] })));
    await expect(startFlashcardQuiz(getToken, documentId, { deck_id: deckId, count: 1 })).rejects.toThrow('invalid service response');
  });
});
