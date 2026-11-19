import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { documents, users } from './schema';

/** Private, immutable extracted-text versions. Original source files are not retained. */
export const sourceVersions = pgTable(
  'source_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id'),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_source_versions_owner_hash').on(t.userId, t.contentHash),
    foreignKey({
      name: 'fk_source_versions_document_owner',
      columns: [t.documentId, t.userId],
      foreignColumns: [documents.id, documents.userId],
    }).onDelete('cascade'),
    check('ck_source_versions_hash', sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('ck_source_versions_snapshot_object', sql`jsonb_typeof(${t.snapshot}) = 'object'`),
    // The API's compact JSON bound is 2 MiB; PostgreSQL JSONB text adds whitespace.
    check('ck_source_versions_snapshot_size', sql`octet_length(${t.snapshot}::text) <= 3145728`),
    index('idx_source_versions_owner_created').on(t.userId, t.createdAt),
    index('idx_source_versions_document').on(t.documentId),
  ],
);
