import { describe, expect, it } from 'vitest';
import { BoardLearningRequestSchema, BoardLearningResponseSchema } from '../src/whiteboard-learning-api';

const response = {
  board_id: 'e29093a6-4065-4480-b194-d6d1e13c34f4',
  revision: 2,
  action: 'cards',
  excerpts: [{ id: 'queue', text: 'A queue serves the first item first.' }],
  answer: null,
  answer_excerpt_ids: [],
  nodes: [],
  cards: [{ front: 'What is the order?', back: 'First in, first out.', excerpt_ids: ['queue'] }],
};

describe('selected board learning boundary', () => {
  it('allows only a saved, bounded selection and an action-specific question', () => {
    expect(BoardLearningRequestSchema.parse({ action: 'cards', revision: 2, shape_ids: ['queue'] })).toEqual({
      action: 'cards',
      revision: 2,
      shape_ids: ['queue'],
    });
    for (const invalid of [
      { action: 'tutor', revision: 2, shape_ids: ['queue'] },
      { action: 'cards', revision: '2', shape_ids: ['queue'] },
      { action: 'cards', revision: 2, shape_ids: ['queue', 'queue'] },
      { action: 'cards', revision: 2, shape_ids: ['queue'], question: 'Injected question' },
      { action: 'cards', revision: 2, shape_ids: ['queue'], excerpts: ['Forged source'] },
      { action: 'map', revision: 2, shape_ids: Array.from({ length: 21 }, (_, i) => String(i)) },
    ])
      expect(BoardLearningRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('requires action-specific output and exact selected evidence IDs', () => {
    expect(BoardLearningResponseSchema.parse(response)).toEqual(response);
    const whitespace = { ...response, excerpts: [{ id: 'queue', text: '  A queue\n' }] };
    expect(BoardLearningResponseSchema.parse(whitespace).excerpts[0]?.text).toBe('  A queue\n');
    for (const invalid of [
      { ...response, action: 'map' },
      { ...response, answer: 'Unexpected extra answer' },
      { ...response, cards: [] },
      { ...response, excerpts: [...response.excerpts, ...response.excerpts] },
      { ...response, cards: [{ ...response.cards[0], excerpt_ids: ['foreign-shape'] }] },
      { ...response, cards: [{ ...response.cards[0], excerpt_ids: ['queue', 'queue'] }] },
    ])
      expect(BoardLearningResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('bounds Unicode text by code points and refuses malformed surrogates', () => {
    const tutor = { action: 'tutor', revision: 1, shape_ids: ['queue'], question: '🙂'.repeat(240) };
    expect(BoardLearningRequestSchema.safeParse(tutor).success).toBe(true);
    expect(BoardLearningRequestSchema.safeParse({ ...tutor, question: tutor.question + 'x' }).success).toBe(
      false,
    );
    expect(BoardLearningRequestSchema.safeParse({ ...tutor, question: '\ud800' }).success).toBe(false);
  });
});
