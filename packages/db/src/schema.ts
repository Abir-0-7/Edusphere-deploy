import { courseGenerationRuns } from './generation-schema';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
  (t) => [unique('uq_documents_id_owner').on(t.id, t.userId), index('idx_documents_user').on(t.userId)],
);

export const conceptGraphs = pgTable(
  'concept_graphs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    revision: integer('revision').notNull().default(1),
    graph: jsonb('graph').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_concept_graph_document_owner').on(t.documentId, t.userId),
    foreignKey({
      name: 'fk_concept_graph_source_owner',
      columns: [t.documentId, t.userId],
      foreignColumns: [documents.id, documents.userId],
    }).onDelete('cascade'),
    check('ck_concept_graph_revision', sql`${t.revision} > 0`),
    check('ck_concept_graph_object', sql`jsonb_typeof(${t.graph}) = 'object'`),
    index('idx_concept_graphs_user_updated').on(t.userId, t.updatedAt),
  ],
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

export const flashcardDecks = pgTable(
  'flashcard_decks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'fk_flashcard_decks_document_owner',
      columns: [t.documentId, t.userId],
      foreignColumns: [documents.id, documents.userId],
    }).onDelete('cascade'),
    unique('uq_flashcard_decks_id_document_owner').on(t.id, t.documentId, t.userId),
    check('ck_flashcard_decks_name', sql`char_length(btrim(${t.name})) BETWEEN 1 AND 120`),
    uniqueIndex('uq_flashcard_decks_default')
      .on(t.userId, t.documentId)
      .where(sql`${t.isDefault}`),
    uniqueIndex('uq_flashcard_decks_named')
      .on(t.userId, t.documentId, t.name)
      .where(sql`NOT ${t.isDefault}`),
  ],
);

export const flashcards = pgTable(
  'flashcards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // Migration 0011 assigns a default deck to legacy inserts.
    deckId: uuid('deck_id').notNull(),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    sourceChunkId: uuid('source_chunk_id'),
    sourceQuote: text('source_quote'),
    sourceRevision: varchar('source_revision', { length: 64 }),
    tags: jsonb('tags').notNull().default([]),
    status: text('status').notNull().default('active'),
    needsReview: boolean('needs_review').notNull().default(false),
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
  (t) => [
    check(
      'ck_flashcards_evidence_pair',
      sql`(${t.sourceQuote} IS NULL AND ${t.sourceRevision} IS NULL) OR (btrim(${t.sourceQuote}) <> '' AND ${t.sourceRevision} ~ '^[0-9a-f]{64}$')`,
    ),
    foreignKey({
      name: 'fk_flashcards_document_owner',
      columns: [t.documentId, t.userId],
      foreignColumns: [documents.id, documents.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flashcards_deck_document_owner',
      columns: [t.deckId, t.documentId, t.userId],
      foreignColumns: [flashcardDecks.id, flashcardDecks.documentId, flashcardDecks.userId],
    }).onDelete('cascade'),
    unique('uq_flashcards_id_owner').on(t.id, t.userId),
    index('idx_flashcards_due').on(t.userId, t.dueDate),
    index('idx_flashcards_deck').on(t.deckId),
    check('ck_flashcards_status', sql`${t.status} IN ('active','retired')`),
    check(
      'ck_flashcards_tags',
      sql`jsonb_typeof(${t.tags}) = 'array' AND jsonb_array_length(${t.tags}) <= 20`,
    ),
  ],
);

export const flashcardQualityReports = pgTable(
  'flashcard_quality_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('received'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'fk_flashcard_quality_reports_card_owner',
      columns: [t.cardId, t.userId],
      foreignColumns: [flashcards.id, flashcards.userId],
    }).onDelete('cascade'),
    index('idx_flashcard_quality_reports_user_created').on(t.userId, t.createdAt),
  ],
);

export const flashcardQuizSessions = pgTable(
  'flashcard_quiz_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    deckId: uuid('deck_id').notNull(),
    questions: jsonb('questions').notNull(),
    answerKey: jsonb('answer_key').notNull(),
    submittedAnswers: jsonb('submitted_answers'),
    result: jsonb('result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'fk_flashcard_quiz_sessions_document_owner',
      columns: [t.documentId, t.userId],
      foreignColumns: [documents.id, documents.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flashcard_quiz_sessions_deck_owner',
      columns: [t.deckId, t.documentId, t.userId],
      foreignColumns: [flashcardDecks.id, flashcardDecks.documentId, flashcardDecks.userId],
    }).onDelete('cascade'),
    index('idx_flashcard_quiz_sessions_user_created').on(t.userId, t.createdAt),
  ],
);

export const flashcardVersions = pgTable(
  'flashcard_versions',
  {
    cardId: uuid('card_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    // Historical locators must be resolved against the original source and revision.
    chapterId: uuid('chapter_id'),
    sourceChunkId: uuid('source_chunk_id'),
    sourceQuote: text('source_quote'),
    sourceRevision: text('source_revision'),
    tags: jsonb('tags').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_flashcard_versions', columns: [t.cardId, t.version] }),
    foreignKey({
      name: 'fk_flashcard_versions_card_owner',
      columns: [t.cardId, t.userId],
      foreignColumns: [flashcards.id, flashcards.userId],
    }).onDelete('cascade'),
    check('ck_flashcard_versions_positive', sql`${t.version} > 0`),
    index('idx_flashcard_versions_user').on(t.userId),
  ],
);

export const flashcardGenerationDrafts = pgTable(
  'flashcard_generation_drafts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    sourceRevision: text('source_revision').notNull(),
    settings: jsonb('settings').notNull(),
    cards: jsonb('cards').notNull(),
    mergeResult: jsonb('merge_result'),
    selectedIds: jsonb('selected_ids'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'fk_flashcard_generation_drafts_document_owner',
      columns: [t.documentId, t.userId],
      foreignColumns: [documents.id, documents.userId],
    }).onDelete('cascade'),
    check('ck_flashcard_generation_drafts_revision', sql`${t.sourceRevision} ~ '^[0-9a-f]{64}$'`),
    index('idx_flashcard_generation_drafts_user_created').on(t.userId, t.createdAt),
    index('idx_flashcard_generation_drafts_document').on(t.documentId),
  ],
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
    result: jsonb('result'),
    /** Client-generated idempotency key so an offline retry is recorded once. */
    clientReviewId: uuid('client_review_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'fk_reviews_card_owner',
      columns: [t.flashcardId, t.userId],
      foreignColumns: [flashcards.id, flashcards.userId],
    }).onDelete('cascade'),
    index('idx_reviews_card').on(t.flashcardId),
    unique('uq_reviews_client_id').on(t.clientReviewId),
  ],
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
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_jobs_poll').on(t.status, t.runAfter),
    index('idx_jobs_status_lease').on(t.status, t.leaseExpiresAt),
    uniqueIndex('uq_jobs_kind_dedupe')
      .on(t.kind, t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
  ],
);

/** Owner-scoped private AI cache; keys contain only versioned hashes. */
export const aiResponseCache = pgTable(
  'ai_response_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    generationRunId: uuid('generation_run_id'),
    cacheKey: varchar('cache_key', { length: 64 }).notNull(),
    content: text('content').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_ai_response_cache_user_key').on(t.userId, t.cacheKey),
    foreignKey({
      name: 'fk_ai_response_cache_document_owner',
      columns: [t.documentId, t.userId],
      foreignColumns: [documents.id, documents.userId],
    }).onDelete('cascade'),
    index('idx_ai_response_cache_user_expiry').on(t.userId, t.expiresAt),
    index('idx_ai_response_cache_document').on(t.documentId),
    foreignKey({
      name: 'fk_response_cache_generation_owner',
      columns: [t.generationRunId, t.userId],
      foreignColumns: [courseGenerationRuns.id, courseGenerationRuns.userId],
    }).onDelete('cascade'),
    index('idx_ai_response_cache_generation').on(t.generationRunId, t.userId),
  ],
);

/** Router usage metadata stores provider accounting, never prompts or source text. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    operationId: uuid('operation_id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
    outcome: text('outcome').notNull().default('pending'),
    cacheHit: boolean('cache_hit').notNull().default(false),
    providerAttempts: integer('provider_attempts').notNull().default(0),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_ai_usage_operation_owner').on(t.operationId, t.userId),
    index('idx_ai_usage_user_created').on(t.userId, t.createdAt),
  ],
);

export const aiUsageAttempts = pgTable(
  'ai_usage_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => aiUsage.operationId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    outcome: text('outcome').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_ai_usage_attempt_operation_no').on(t.operationId, t.attemptNo),
    foreignKey({
      name: 'fk_ai_usage_attempts_operation_owner',
      columns: [t.operationId, t.userId],
      foreignColumns: [aiUsage.operationId, aiUsage.userId],
    }).onDelete('cascade'),
    index('idx_ai_usage_attempts_user_created').on(t.userId, t.createdAt),
  ],
);

/** Provider-effect reservations: an uncertain result must not be retried as success. */
export const aiOperations = pgTable(
  'ai_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    generationRunId: uuid('generation_run_id'),
    operationKey: varchar('operation_key', { length: 64 }).notNull(),
    state: text('state').notNull(),
    result: text('result'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_ai_operations_owner_key').on(t.userId, t.operationKey),
    foreignKey({
      name: 'fk_ai_operations_document_owner',
      columns: [t.documentId, t.userId],
      foreignColumns: [documents.id, documents.userId],
    }).onDelete('cascade'),
    index('idx_ai_operations_owner_expiry').on(t.userId, t.expiresAt),
    foreignKey({
      name: 'fk_operations_generation_owner',
      columns: [t.generationRunId, t.userId],
      foreignColumns: [courseGenerationRuns.id, courseGenerationRuns.userId],
    }).onDelete('cascade'),
    index('idx_ai_operations_generation').on(t.generationRunId, t.userId),
  ],
);

export const aiBudgetReservations = pgTable(
  'ai_budget_reservations',
  {
    operationId: uuid('operation_id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
    budgetDay: date('budget_day').notNull(),
    reservedTokens: integer('reserved_tokens').notNull(),
    actualTokens: integer('actual_tokens'),
    state: text('state').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_ai_budget_day_feature').on(t.budgetDay, t.feature),
    index('idx_ai_budget_owner_day').on(t.userId, t.budgetDay),
    index('idx_ai_budget_state_expiry').on(t.state, t.expiresAt),
    check(
      'ck_ai_budget_reservations_values',
      sql`${t.reservedTokens} > 0 AND (${t.actualTokens} IS NULL OR ${t.actualTokens} BETWEEN 0 AND ${t.reservedTokens}) AND ${t.state} IN ('reserved','settled','released','expired')`,
    ),
  ],
);

/** Atomic per-owner UTC-minute admission window for deployment without Redis. */
export const aiMinuteLimits = pgTable(
  'ai_minute_limits',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ name: 'pk_ai_minute_limits', columns: [t.userId, t.windowStart] }),
    check('ck_ai_minute_limits_count', sql`${t.count} BETWEEN 1 AND 100000`),
    index('idx_ai_minute_limits_window').on(t.windowStart),
  ],
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

/** Server-authoritative Game Vault mission entitlements and progression. */
export const gameMissionProgress = pgTable(
  'game_mission_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: text('game_id').notNull(),
    missionId: text('mission_id').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    xpAwarded: integer('xp_awarded').notNull().default(0),
    achievements: jsonb('achievements').$type<string[]>().notNull().default([]),
  },
  (t) => [
    unique('uq_game_mission_progress_user_game_mission').on(t.userId, t.gameId, t.missionId),
    index('idx_game_mission_progress_user_game').on(t.userId, t.gameId),
  ],
);

/** Study guilds and memberships; membership user IDs are always scoped to the owner. */
export const studyGuilds = pgTable(
  'study_guilds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    guildId: uuid('guild_id')
      .notNull()
      .references(() => studyGuilds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_study_guild_member').on(t.guildId, t.userId),
    index('idx_guild_members_user').on(t.userId),
  ],
);

/** Immutable authored course catalog and private, resumable learner state. */
export const courses = pgTable('courses', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const courseReleases = pgTable(
  'course_releases',
  {
    id: uuid('id').primaryKey(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    status: text('status').notNull(),
    visibility: text('visibility').notNull(),
    content: jsonb('content').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_course_release_version').on(t.courseId, t.version),
    index('idx_course_releases_course').on(t.courseId),
  ],
);

export const courseEnrollments = pgTable(
  'course_enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => courseReleases.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    state: jsonb('state').notNull(),
    revision: integer('revision').notNull().default(0),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_course_enrollment_release').on(t.userId, t.releaseId),
    index('idx_course_enrollments_user').on(t.userId, t.updatedAt),
  ],
);

export const courseAttempts = pgTable(
  'course_attempts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => courseEnrollments.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id').notNull(),
    kind: text('kind').notNull(),
    request: jsonb('request').notNull(),
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_course_attempts_user').on(t.userId),
    index('idx_course_attempts_enrollment').on(t.enrollmentId),
  ],
);

/** Explicit learner profile; diagnostic signals do not award mastery. */
export const learnerProfiles = pgTable('learner_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  goalKind: text('goal_kind').notNull(),
  goal: varchar('goal', { length: 200 }).notNull(),
  familiarity: text('familiarity').notNull(),
  weeklyMinutes: integer('weekly_minutes').notNull(),
  deadline: text('deadline'),
  language: text('language').notNull(),
  accessibility: jsonb('accessibility').notNull(),
  roleVariant: text('role_variant').notNull().default('auto'),
  explanationDepth: text('explanation_depth').notNull().default('standard'),
  pace: text('pace').notNull().default('standard'),
  diagnostic: jsonb('diagnostic').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const learnerTrackPlanRevisions = pgTable(
  'learner_track_plan_revisions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    trackId: text('track_id').notNull(),
    requiredCourseSlugs: jsonb('required_course_slugs').$type<string[]>().notNull(),
    requiredObjectiveIds: jsonb('required_objective_ids').$type<string[]>().notNull(),
    objectiveMapping: jsonb('objective_mapping').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_learner_track_plan_user_revision').on(t.userId, t.revision)],
);

export const learnerRecommendationSnapshots = pgTable('learner_recommendation_snapshots', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  snapshot: jsonb('snapshot').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
