import { describe, expect, it } from 'vitest';
import {
  StudioDeckListSchema,
  StudioDraftMergeRequestSchema,
  StudioDraftResponseSchema,
  StudioGenerationSettingsSchema,
} from '@studyvault/types';

const settings = {
  chapter_ids: ['11111111-1111-4111-8111-111111111111'],
  topic: null,
  language: 'en',
  difficulty: 'basic',
  count: 1,
} as const;
const card = {
  id: '44444444-4444-4444-8444-444444444444',
  chapter_id: settings.chapter_ids[0],
  source_chunk_id: '22222222-2222-4222-8222-222222222222',
  source_quote: 'Evidence that belongs to this source.',
  front: 'What does this idea mean?',
  back: 'A short and grounded answer.',
  page: null,
} as const;

describe('flashcard studio contracts', () => {
  it('bounds generation settings and rejects repeated or oversized chapter sets', () => {
    expect(StudioGenerationSettingsSchema.safeParse(settings).success).toBe(true);
    expect(StudioGenerationSettingsSchema.safeParse({ ...settings, chapter_ids: [...settings.chapter_ids, ...settings.chapter_ids] }).success).toBe(false);
    expect(StudioGenerationSettingsSchema.safeParse({ ...settings, count: 21 }).success).toBe(false);
    expect(StudioGenerationSettingsSchema.safeParse({ ...settings, topic: ' '.repeat(121) }).success).toBe(false);
  });

  it('rejects evidence that belongs to an unselected chapter or invalid page', () => {
    const draft = {
      id: '33333333-3333-4333-8333-333333333333',
      source_revision: 'a'.repeat(64),
      settings,
      cards: [card],
      merge_result: null,
    };
    expect(StudioDraftResponseSchema.safeParse(draft).success).toBe(true);
    expect(StudioDraftResponseSchema.safeParse({ ...draft, cards: [{ ...card, chapter_id: '11111111-1111-4111-8111-999999999999' }] }).success).toBe(false);
    expect(StudioDraftResponseSchema.safeParse({ ...draft, cards: [{ ...card, page: 0 }] }).success).toBe(false);
  });

  it('bounds explicit merges and validates listed deck summaries', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    expect(StudioDraftMergeRequestSchema.safeParse({ card_ids: [id], deck_name: 'Exam prep' }).success).toBe(true);
    expect(StudioDraftMergeRequestSchema.safeParse({ card_ids: [id, id] }).success).toBe(false);
    expect(StudioDeckListSchema.safeParse([{ id, name: 'Default', is_default: true, card_count: 0 }]).success).toBe(true);
    expect(StudioDeckListSchema.safeParse([{ id, name: 'Default', is_default: true, card_count: -1 }]).success).toBe(false);
  });

  it('accepts explicit one-to-one replacements and rejects duplicate targets', () => {
    const candidate = '33333333-3333-4333-8333-333333333333';
    const target = '55555555-5555-4555-8555-555555555555';
    expect(StudioDraftMergeRequestSchema.safeParse({
      card_ids: [candidate],
      replacements: [{ draft_card_id: candidate, card_id: target }],
    }).success).toBe(true);
    expect(StudioDraftMergeRequestSchema.safeParse({
      card_ids: [candidate],
      replacements: [
        { draft_card_id: candidate, card_id: target },
        { draft_card_id: candidate, card_id: '66666666-6666-4666-8666-666666666666' },
      ],
    }).success).toBe(false);
  });
});
