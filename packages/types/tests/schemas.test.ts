import { describe, expect, it } from 'vitest';
import {
  ChatMessageSchema,
  ErrorSchema,
  FlashcardSchema,
  ParsePdfResponseSchema,
  ReviewGradeSchema,
  SummaryLevelSchema,
} from '../src/index';

describe('shared contracts', () => {
  it('parses the shared error shape', () => {
    const parsed = ErrorSchema.parse({ code: 'rate_limited', message: 'slow down' });
    expect(parsed.code).toBe('rate_limited');
    expect(() => ErrorSchema.parse({ code: 'nope', message: 'x' })).toThrow();
  });

  it('validates summary levels and review grades', () => {
    expect(SummaryLevelSchema.safeParse('eli5').success).toBe(true);
    expect(SummaryLevelSchema.safeParse('poem').success).toBe(false);
    expect(ReviewGradeSchema.safeParse(5).success).toBe(true);
    expect(ReviewGradeSchema.safeParse(6).success).toBe(false);
  });

  it('validates the PDF upload handoff identifiers', () => {
    const parsed = ParsePdfResponseSchema.parse({
      job_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      document_id: '4f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
    expect(parsed.document_id).toContain('4f2504e0');
    expect(() => ParsePdfResponseSchema.parse({ job_id: 'not-a-uuid', document_id: 'x' })).toThrow();
  });

  it('validates flashcards and chat messages', () => {
    const card = FlashcardSchema.parse({
      id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      front: 'q',
      back: 'a',
      sourceChunkId: null,
      easeFactor: 2.5,
      intervalDays: 1,
      repetitions: 1,
      dueDate: '2025-01-01',
    });
    expect(card.intervalDays).toBe(1);
    const msg = ChatMessageSchema.parse({ role: 'assistant', content: 'hi', citations: [] });
    expect(msg.role).toBe('assistant');
    expect(() => ChatMessageSchema.parse({ role: 'system', content: 'x' })).toThrow();
  });
});
