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
} from 'drizzle-orm/pg-core';

import { courseOutlineApprovals, courseOutlines } from './outline-schema';
import { users } from './schema';

/** Private resumable drafts. No generation write publishes or replaces a course release. */
export const courseGenerationRuns = pgTable(
  'course_generation_runs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    outlineId: uuid('outline_id').notNull(),
    approvalId: uuid('approval_id').notNull(),
    activeJobId: uuid('active_job_id'),
    revision: integer('revision').notNull().default(1),
    state: jsonb('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_course_generation_runs_owner').on(t.id, t.userId),
    foreignKey({
      name: 'fk_generation_outline_owner',
      columns: [t.outlineId, t.userId],
      foreignColumns: [courseOutlines.id, courseOutlines.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_generation_approval_owner_outline',
      columns: [t.approvalId, t.userId, t.outlineId],
      foreignColumns: [
        courseOutlineApprovals.id,
        courseOutlineApprovals.userId,
        courseOutlineApprovals.outlineId,
      ],
    }).onDelete('cascade'),
    check('ck_generation_revision', sql`${t.revision} > 0`),
    check('ck_generation_state_object', sql`jsonb_typeof(${t.state}) = 'object'`),
    check('ck_generation_state_size', sql`octet_length(${t.state}::text) <= 2097152`),
    index('idx_course_generation_owner_updated').on(t.userId, t.updatedAt),
    index('idx_course_generation_outline').on(t.outlineId, t.userId),
  ],
);

/** Append-only authored overlays; generated outputs and cost records are never rewritten. */
export const courseGenerationLessonEdits = pgTable(
  'course_generation_lesson_edits',
  {
    runId: uuid('run_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectiveId: text('objective_id').notNull(),
    revision: integer('revision').notNull(),
    output: jsonb('output').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    copiedFromRunId: uuid('copied_from_run_id'),
    copiedFromRevision: integer('copied_from_revision'),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.objectiveId, t.revision] }),
    foreignKey({
      name: 'fk_generation_edits_run_owner',
      columns: [t.runId, t.userId],
      foreignColumns: [courseGenerationRuns.id, courseGenerationRuns.userId],
    }).onDelete('cascade'),
    check('ck_generation_edits_revision', sql`${t.revision} BETWEEN 1 AND 5`),
    check('ck_generation_edits_objective', sql`${t.objectiveId} ~ '^[A-Za-z0-9_-]{1,80}$'`),
    check(
      'ck_generation_edits_output',
      sql`jsonb_typeof(${t.output}) = 'object' AND octet_length(${t.output}::text) <= 65536`,
    ),
    check(
      'ck_generation_edits_copy',
      sql`(${t.copiedFromRunId} IS NULL AND ${t.copiedFromRevision} IS NULL) OR (${t.copiedFromRunId} IS NOT NULL AND ${t.copiedFromRevision} IS NOT NULL AND ${t.copiedFromRevision} BETWEEN 1 AND 5)`,
    ),
    index('idx_generation_edits_owner_run').on(t.userId, t.runId),
  ],
);
