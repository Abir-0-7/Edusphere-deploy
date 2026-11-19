import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './schema';
import { sourceVersions } from './source-schema';

/** Private owner-authored planning, deliberately separate from publishable releases. */
export const courseOutlines = pgTable(
  'course_outlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull().default(1),
    plan: jsonb('plan').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    status: text('status').notNull().default('draft'),
    approvedRevision: integer('approved_revision'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_course_outlines_id_owner').on(t.id, t.userId),
    check('ck_course_outlines_revision', sql`${t.revision} > 0`),
    check('ck_course_outlines_hash', sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('ck_course_outlines_plan_object', sql`jsonb_typeof(${t.plan}) = 'object'`),
    check('ck_course_outlines_plan_size', sql`octet_length(${t.plan}::text) <= 262144`),
    check(
      'ck_course_outlines_approval',
      sql`(${t.status} = 'draft' AND ${t.approvedRevision} IS NULL AND ${t.approvedAt} IS NULL) OR (${t.status} = 'approved' AND ${t.approvedRevision} IS NOT NULL AND ${t.approvedRevision} = ${t.revision} AND ${t.approvedAt} IS NOT NULL)`,
    ),
    index('idx_course_outlines_owner_updated').on(t.userId, t.updatedAt),
  ],
);

/** Current and approved historical sources; source deletion removes dependent outlines. */
export const courseOutlineSources = pgTable(
  'course_outline_sources',
  {
    outlineId: uuid('outline_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceVersionId: uuid('source_version_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.outlineId, t.sourceVersionId] }),
    foreignKey({
      name: 'fk_outline_sources_outline_owner',
      columns: [t.outlineId, t.userId],
      foreignColumns: [courseOutlines.id, courseOutlines.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_outline_sources_version_owner',
      columns: [t.sourceVersionId, t.userId],
      foreignColumns: [sourceVersions.id, sourceVersions.userId],
    }).onDelete('cascade'),
    index('idx_outline_sources_version_owner').on(t.sourceVersionId, t.userId),
    index('idx_outline_sources_owner').on(t.userId),
  ],
);

/** Immutable approval audit snapshots. Approval grants no editorial/catalog authority. */
export const courseOutlineApprovals = pgTable(
  'course_outline_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    outlineId: uuid('outline_id').notNull(),
    revision: integer('revision').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_outline_approvals_outline_revision').on(t.outlineId, t.revision),
    unique('uq_outline_approvals_owner_outline').on(t.id, t.userId, t.outlineId),
    foreignKey({
      name: 'fk_outline_approvals_outline_owner',
      columns: [t.outlineId, t.userId],
      foreignColumns: [courseOutlines.id, courseOutlines.userId],
    }).onDelete('cascade'),
    check('ck_outline_approvals_revision', sql`${t.revision} > 0`),
    check('ck_outline_approvals_hash', sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('ck_outline_approvals_snapshot_object', sql`jsonb_typeof(${t.snapshot}) = 'object'`),
    check('ck_outline_approvals_snapshot_size', sql`octet_length(${t.snapshot}::text) <= 524288`),
    index('idx_outline_approvals_owner_created').on(t.userId, t.createdAt),
  ],
);
