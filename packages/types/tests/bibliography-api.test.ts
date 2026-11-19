import { describe, expect, it } from 'vitest';
import {
  BibliographyDateSchema,
  BibliographyItemInputSchema,
  BibliographyItemKindSchema,
  BibliographyMetadataSuggestionSchema,
} from '../src/bibliography-api';
import { normalizeIsbn } from '../src/isbn';

describe('editable bibliography contracts', () => {
  it.each(['book', 'book_chapter', 'journal_article', 'website', 'repository'] as const)(
    'accepts the %s record kind while preserving missing values',
    (kind) => {
      const result = BibliographyItemInputSchema.parse({ kind });
      expect(result.title).toBe('');
      expect(result.authors).toEqual([]);
      expect(result.issued).toBeNull();
      expect(result.accessed).toBeNull();
    },
  );

  it('keeps names, dates, item page ranges and library links as separate fields', () => {
    const item = BibliographyItemInputSchema.parse({
      kind: 'journal_article',
      authors: [{ given: 'Ada', family: 'Lovelace' }, { literal: 'The Numerical Society' }],
      issued: { year: 1843 },
      container_title: 'Memoirs',
      item_pages: '12–18',
      source_document_id: 'e638440e-7218-4c7c-82f2-3f729f31b6b6',
    });
    expect(item.authors).toHaveLength(2);
    expect(item.issued).toEqual({ year: 1843 });
    expect(item.item_pages).toBe('12–18');
    expect(item.source_document_id).toBe('e638440e-7218-4c7c-82f2-3f729f31b6b6');
    expect(() => BibliographyItemInputSchema.parse({ kind: 'book', citation_locator: 'page 14' })).toThrow();
  });

  it('validates partial dates but keeps a missing date missing', () => {
    expect(BibliographyDateSchema.parse({ year: 2020 })).toEqual({ year: 2020 });
    expect(BibliographyDateSchema.parse({ year: 2020, month: 2 })).toEqual({ year: 2020, month: 2 });
    expect(BibliographyDateSchema.safeParse({ month: 2 }).success).toBe(false);
    expect(BibliographyDateSchema.safeParse({ year: 2020, month: 2, day: 30 }).success).toBe(false);
    expect(BibliographyDateSchema.safeParse({ year: 2020, literal: 'circa 2020' }).success).toBe(false);
  });

  it('requires explicit confirmation for manually entered provenance', () => {
    expect(
      BibliographyItemInputSchema.safeParse({
        kind: 'website',
        title: 'StudyVault docs',
        metadata_provenance: [{ field: 'title', source: 'manual', confirmed: false }],
      }).success,
    ).toBe(false);
    expect(
      BibliographyItemInputSchema.safeParse({
        kind: 'website',
        title: 'StudyVault docs',
        metadata_provenance: [{ field: 'title', source: 'manual', confirmed: true }],
      }).success,
    ).toBe(true);
  });

  it('stores uncertain metadata separately without filling confirmed fields', () => {
    const suggestion = BibliographyMetadataSuggestionSchema.parse({
      field: 'issued',
      value: '2023',
      source: 'doi',
    });
    const item = BibliographyItemInputSchema.parse({
      kind: 'journal_article',
      metadata_suggestions: [suggestion],
    });
    expect(item.issued).toBeNull();
    expect(item.metadata_suggestions).toEqual([suggestion]);
  });

  it('rejects an unsupported record kind instead of coercing it', () => {
    expect(BibliographyItemKindSchema.safeParse('dataset').success).toBe(false);
  });

  it('normalizes and validates ISBN-10/ISBN-13 checksums', () => {
    expect(normalizeIsbn('0-306-40615-2')).toBe('9780306406157');
    expect(normalizeIsbn('978-0-306-40615-7')).toBe('9780306406157');
    expect(normalizeIsbn('9780306406158')).toBeNull();
    expect(BibliographyItemInputSchema.safeParse({ kind: 'book', isbn: '9780306406158' }).success).toBe(
      false,
    );
  });
});
