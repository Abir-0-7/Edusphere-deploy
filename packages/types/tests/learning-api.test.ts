import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ChapterResponseSchema,
  ChatReplySchema,
  ChatRequestSchema,
  ErrorEnvelopeSchema,
  FlashcardGenerationResponseSchema,
  FlashcardResponseSchema,
  JobResponseSchema,
  ParsePdfResponseSchema,
  ReviewRequestSchema,
  ReviewResultSchema,
} from '../src/index';

// Python's HTTP/model tests use this exact fixture too.
const fixture = JSON.parse(
  readFileSync(new URL('../../../contracts/learning-api.json', import.meta.url), 'utf8'),
);

describe('FastAPI wire contracts', () => {
  it('accepts the same snake_case payloads as the Python models', () => {
    const schemas = {
      upload: ParsePdfResponseSchema,
      job: JobResponseSchema,
      chapter: ChapterResponseSchema,
      flashcard: FlashcardResponseSchema,
      generation: FlashcardGenerationResponseSchema,
      review_request: ReviewRequestSchema,
      review: ReviewResultSchema,
      review_replay: ReviewResultSchema,
      chat_request: ChatRequestSchema,
      chat: ChatReplySchema,
      error: ErrorEnvelopeSchema,
    };
    for (const [name, schema] of Object.entries(schemas)) {
      expect(schema.parse(fixture[name])).toEqual(fixture[name]);
    }
  });

  it('separates scheduling responses from flashcards and preserves replay information', () => {
    expect(ReviewResultSchema.parse(fixture.review_replay).replayed).toBe(true);
    expect(FlashcardResponseSchema.safeParse(fixture.review).success).toBe(false);
    expect(FlashcardResponseSchema.safeParse({ ...fixture.flashcard, due_date: '2026-02-30' }).success).toBe(
      false,
    );
    expect(FlashcardResponseSchema.safeParse({ ...fixture.flashcard, interval_days: -1 }).success).toBe(
      false,
    );
  });

  it('rejects camelCase wire drift, invalid citations and invalid review input', () => {
    expect(
      ChapterResponseSchema.safeParse({ ...fixture.chapter, start_page: undefined, startPage: 1 }).success,
    ).toBe(false);
    expect(
      ChatReplySchema.safeParse({ answer: 'x', citations: [{ chunkId: 'x', page: 1, quote: 'x' }] }).success,
    ).toBe(false);
    for (const grade of [true, false, 4.2, '4', null, -1, 6]) {
      expect(ReviewRequestSchema.safeParse({ grade }).success).toBe(false);
    }
    expect(ReviewRequestSchema.safeParse({ grade: 4, review_id: 'broken' }).success).toBe(false);
    for (const question of [[], {}, 42, null, '  ', 'x'.repeat(4001)]) {
      expect(ChatRequestSchema.safeParse({ question }).success).toBe(false);
    }
  });
});
