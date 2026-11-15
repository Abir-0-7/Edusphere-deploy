import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/** pgvector column (384-dim MiniLM embeddings). */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(384)';
  },
});

/** Migration 0000 is adjusted: it must start with CREATE EXTENSION IF NOT EXISTS vector;
 *  (drizzle-kit can't emit extension statements — keep this when regenerating). */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull(),
  dailyAiQuotaUsed: integer('daily_ai_quota_used').notNull().default(0),
  quotaResetDate: text('quota_reset_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    pageCount: integer('page_count'),
    status: text('status').notNull().default('pending'), // pending|parsed|failed
    markdown: text('markdown'),
    /** Temporary: the uploaded PDF bytes, cleared as soon as parsing finishes.
     *  Originals are NOT retained (see docs/schema.md). */
    sourceBytes: customType<{ data: Buffer; driverData: Buffer }>({
      dataType() {
        return 'bytea';
      },
    })('source_bytes'),
    errorReason: text('error_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_documents_user').on(t.userId)],
);

export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    ordinal: integer('ordinal').notNull(),
    startPage: integer('start_page'),
    endPage: integer('end_page'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_chapters_doc_ordinal').on(t.documentId, t.ordinal),
    index('idx_chapters_doc').on(t.documentId),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    page: integer('page'),
    ordinal: integer('ordinal').notNull(),
    embedding: vector('embedding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_chunks_doc').on(t.documentId),
    index('idx_chunks_fts').using('gin', sql`to_tsvector('english', ${t.content})`),
    index('idx_chunks_vec').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // JSONB messages: ChatMessage[] from @studyvault/types
    messages: jsonb('messages').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_chat_sessions_user_doc').on(t.userId, t.documentId)],
);

export const flashcards = pgTable(
  'flashcards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    sourceChunkId: uuid('source_chunk_id'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    front: text('front').notNull(),
    back: text('back').notNull(),
    // SM-2 state
    easeFactor: real('ease_factor').notNull().default(2.5),
    intervalDays: integer('interval_days').notNull().default(0),
    repetitions: integer('repetitions').notNull().default(0),
    dueDate: varchar('due_date', { length: 10 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_flashcards_due').on(t.userId, t.dueDate)],
);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flashcardId: uuid('flashcard_id')
      .notNull()
      .references(() => flashcards.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grade: integer('grade').notNull(),
    /** Client-generated idempotency key so an offline retry is recorded once. */
    clientReviewId: uuid('client_review_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_reviews_card').on(t.flashcardId), unique('uq_reviews_client_id').on(t.clientReviewId)],
);

/** Chapter summaries (task 2.5). One row per (chapter, level); a regeneration
 *  overwrites, so a reload always shows the latest saved text. */
export const summaries = pgTable(
  'summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    level: text('level').notNull(), // standard|eli5|deep_dive
    content: text('content').notNull(),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_summaries_chapter_level').on(t.chapterId, t.level),
    index('idx_summaries_user').on(t.userId),
  ],
);

/** Global queue (user scoping inside payload). Mirrors docs/schema.md `jobs`. */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(), // parse_pdf|structure_chapters|embed|generate_flashcards
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    errorReason: text('error_reason'),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_jobs_poll').on(t.status, t.runAfter)],
);

/** Focus timer sessions (phase 3). `ended_at` is stored up front so the timer
 *  survives tab sleep and navigation: the client renders from timestamps, not
 *  from a tick counter. */
export const focusSessions = pgTable(
  'focus_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // pomodoro|desk|ultradian
    plannedSeconds: integer('planned_seconds').notNull(),
    actualSeconds: integer('actual_seconds').notNull().default(0),
    status: text('status').notNull().default('running'), // running|completed|abandoned
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    expectedEndAt: timestamp('expected_end_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_focus_sessions_user').on(t.userId, t.startedAt)],
);

/** Append-only activity log feeding the dashboards (phase 3.7). */
export const studyLogs = pgTable(
  'study_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // upload|chat|review|focus|game
    payload: jsonb('payload').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_study_logs_user_time').on(t.userId, t.occurredAt)],
);

/** Saved day-by-day exam plan (task 3.5). One active plan per document; a new
 *  generation replaces it. `plan` is the schema-validated JSON. */
export const studyPlans = pgTable(
  'study_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    examDate: varchar('exam_date', { length: 10 }).notNull(),
    plan: jsonb('plan').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_study_plans_document').on(t.documentId)],
);

/** Cached "Next Week Advice" (task 3.8). Regenerating replaces the row. */
export const weeklyAdvice = pgTable(
  'weekly_advice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    model: text('model'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_weekly_advice_user').on(t.userId)],
);
/** Append-only token ledger; balance = SUM(amount). The (reason, ref_id) unique
 *  constraint is what makes rewards idempotent — a replayed completion cannot
 *  pay twice (task 3.2). */
export const tokenLedger = pgTable(
  'token_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    refId: uuid('ref_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_token_ledger_reason_ref').on(t.reason, t.refId),
    index('idx_token_ledger_user').on(t.userId),
  ],
);

/** Study guilds and memberships; membership user IDs are always scoped to the owner. */
export const studyGuilds = pgTable(
  'study_guilds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    inviteCode: varchar('invite_code', { length: 16 }).notNull().unique(),
    weeklyGoalMinutes: integer('weekly_goal_minutes').notNull().default(300),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_study_guilds_owner').on(t.ownerUserId)],
);

export const studyGuildMembers = pgTable(
  'study_guild_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: uuid('guild_id').notNull().references(() => studyGuilds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_study_guild_member').on(t.guildId, t.userId), index('idx_guild_members_user').on(t.userId)],
);
