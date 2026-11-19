import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { documents, users } from './schema';

/** Private academic bibliography records with optimistic revision checks. */
export const bibliographyItems = pgTable(
  'bibliography_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull().default(''),
    authors: jsonb('authors').notNull().default([]),
    issued: jsonb('issued'),
    containerTitle: text('container_title').notNull().default(''),
    edition: text('edition').notNull().default(''),
    volume: text('volume').notNull().default(''),
    issue: text('issue').notNull().default(''),
    itemPages: text('item_pages').notNull().default(''),
    publisher: text('publisher').notNull().default(''),
    doi: text('doi').notNull().default(''),
    isbn: text('isbn').notNull().default(''),
    url: text('url').notNull().default(''),
    accessed: jsonb('accessed'),
    repositoryCommit: text('repository_commit').notNull().default(''),
    sourceDocumentId: uuid('source_document_id'),
    metadataProvenance: jsonb('metadata_provenance').notNull().default([]),
    metadataSuggestions: jsonb('metadata_suggestions').notNull().default([]),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'fk_bibliography_source_document_owner',
      columns: [t.sourceDocumentId, t.userId],
      foreignColumns: [documents.id, documents.userId],
    }),
    check(
      'ck_bibliography_kind',
      sql`${t.kind} IN ('book', 'book_chapter', 'journal_article', 'website', 'repository')`,
    ),
    check('ck_bibliography_revision', sql`${t.revision} > 0`),
    index('idx_bibliography_user_updated').on(t.userId, t.updatedAt),
    index('idx_bibliography_user_source').on(t.userId, t.sourceDocumentId),
  ],
);
