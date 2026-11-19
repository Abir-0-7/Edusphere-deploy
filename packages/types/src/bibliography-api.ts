import { z } from 'zod';
import { isValidIsbn } from './isbn';

export const BibliographyItemKindSchema = z.enum([
  'book',
  'book_chapter',
  'journal_article',
  'website',
  'repository',
]);
export type BibliographyItemKind = z.infer<typeof BibliographyItemKindSchema>;

// FastAPI serializes optional nested scalars as null. Expose absence consistently
// to editors and citation processors, regardless of which producer sent the record.
const absent = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? undefined);

export const BibliographyDateSchema = z
  .strictObject({
    year: absent(z.number().int().min(1).max(9999)),
    month: absent(z.number().int().min(1).max(12)),
    day: absent(z.number().int().min(1).max(31)),
    literal: absent(z.string().trim().min(1).max(120)),
  })
  .refine(
    (date) =>
      !(date.month !== undefined && date.year === undefined) &&
      !(date.day !== undefined && date.month === undefined) &&
      !(date.literal && (date.year !== undefined || date.month !== undefined || date.day !== undefined)) &&
      (date.year !== undefined || date.literal !== undefined) &&
      (date.day === undefined ||
        new Date(
          new Date(0).setUTCFullYear(date.year ?? 2000, (date.month ?? 1) - 1, date.day),
        ).getUTCDate() === date.day),
    'Use a valid year/month/day combination or a literal date, not both.',
  );
export type BibliographyDate = z.infer<typeof BibliographyDateSchema>;

export const BibliographyAuthorSchema = z
  .strictObject({
    family: absent(z.string().trim().max(160)),
    given: absent(z.string().trim().max(160)),
    literal: absent(z.string().trim().max(240)),
    suffix: absent(z.string().trim().max(40)),
  })
  .refine(
    (author) =>
      Boolean(author.literal?.trim() || author.family?.trim() || author.given?.trim()) &&
      !(author.literal?.trim() && (author.family?.trim() || author.given?.trim() || author.suffix?.trim())),
    'Provide a literal author name or structured name parts.',
  );
export type BibliographyAuthor = z.infer<typeof BibliographyAuthorSchema>;

export const BibliographyFieldSchema = z.enum([
  'title',
  'authors',
  'issued',
  'container_title',
  'edition',
  'volume',
  'issue',
  'item_pages',
  'publisher',
  'doi',
  'url',
  'accessed',
  'repository_commit',
  'isbn',
]);
export type BibliographyField = z.infer<typeof BibliographyFieldSchema>;

export const BibliographyMetadataSourceSchema = z.enum([
  'manual',
  'bibtex',
  'ris',
  'csl_json',
  'doi',
  'url',
  'isbn',
]);

export const BibliographyProvenanceSchema = z
  .strictObject({
    field: BibliographyFieldSchema,
    source: BibliographyMetadataSourceSchema,
    confirmed: z.boolean(),
  })
  .refine((provenance) => provenance.source !== 'manual' || provenance.confirmed, {
    message: 'Manually entered metadata must be confirmed by the user.',
    path: ['confirmed'],
  });
export type BibliographyProvenance = z.infer<typeof BibliographyProvenanceSchema>;

export const BibliographyMetadataSuggestionSchema = z.strictObject({
  field: BibliographyFieldSchema,
  value: z.string().trim().min(1).max(4000),
  source: z.enum(['bibtex', 'ris', 'csl_json', 'doi', 'url']),
});
export type BibliographyMetadataSuggestion = z.infer<typeof BibliographyMetadataSuggestionSchema>;

const bibliographyFields = {
  kind: BibliographyItemKindSchema,
  title: z.string().trim().max(2000).default(''),
  authors: z.array(BibliographyAuthorSchema).max(40).default([]),
  issued: BibliographyDateSchema.nullable().default(null),
  container_title: z.string().trim().max(1000).default(''),
  edition: z.string().trim().max(120).default(''),
  volume: z.string().trim().max(80).default(''),
  issue: z.string().trim().max(80).default(''),
  item_pages: z.string().trim().max(120).default(''),
  publisher: z.string().trim().max(300).default(''),
  doi: z.string().trim().max(300).default(''),
  isbn: z
    .string()
    .trim()
    .max(17)
    .refine((value) => value === '' || isValidIsbn(value), 'Enter a valid ISBN-10 or ISBN-13.')
    .default(''),
  url: z.string().trim().max(2048).default(''),
  accessed: BibliographyDateSchema.nullable().default(null),
  repository_commit: z.string().trim().max(128).default(''),
  source_document_id: z.string().uuid().nullable().default(null),
  metadata_provenance: z.array(BibliographyProvenanceSchema).max(40).default([]),
  metadata_suggestions: z.array(BibliographyMetadataSuggestionSchema).max(40).default([]),
};

function hasUniqueProvenanceFields(provenance: BibliographyProvenance[]) {
  return new Set(provenance.map(({ field }) => field)).size === provenance.length;
}

export const BibliographyItemInputSchema = z
  .strictObject(bibliographyFields)
  .refine((item) => hasUniqueProvenanceFields(item.metadata_provenance), {
    message: 'Metadata provenance may contain only one entry per field.',
    path: ['metadata_provenance'],
  });
export type BibliographyItemInput = z.infer<typeof BibliographyItemInputSchema>;

export const BibliographyItemUpdateSchema = z
  .strictObject({
    ...bibliographyFields,
    expected_revision: z.number().int().positive(),
  })
  .refine((item) => hasUniqueProvenanceFields(item.metadata_provenance), {
    message: 'Metadata provenance may contain only one entry per field.',
    path: ['metadata_provenance'],
  });
export type BibliographyItemUpdate = z.infer<typeof BibliographyItemUpdateSchema>;

export const BibliographyItemSchema = z.strictObject({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  ...bibliographyFields,
});
export type BibliographyItem = z.infer<typeof BibliographyItemSchema>;

export const BibliographyListResponseSchema = z.strictObject({
  items: z.array(BibliographyItemSchema).max(100),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative(),
});

export const BibliographyDeleteResponseSchema = z.strictObject({
  id: z.string().uuid(),
  deleted: z.literal(true),
});
export type BibliographyListResponse = z.infer<typeof BibliographyListResponseSchema>;

export const LibraryDocumentSchema = z.strictObject({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
});
export type LibraryDocument = z.infer<typeof LibraryDocumentSchema>;

export const LibraryDocumentListResponseSchema = z.strictObject({
  documents: z.array(LibraryDocumentSchema).max(100),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative(),
});
