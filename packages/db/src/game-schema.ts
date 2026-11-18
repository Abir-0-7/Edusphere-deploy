import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './schema';

export const gameSessions = pgTable(
  'game_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: text('game_id').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    status: text('status').notNull(),
    revision: integer('revision').notNull().default(0),
    tokensAwarded: integer('tokens_awarded').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_game_sessions_user_updated').on(table.userId, table.updatedAt)],
);

export const realtimeDuels = pgTable(
  'realtime_duels',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    opponentUserId: uuid('opponent_user_id').references(() => users.id, { onDelete: 'cascade' }),
    state: jsonb('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '1 day'`),
  },
  (table) => [
    check('ck_realtime_distinct_players', sql`opponent_user_id IS NULL OR opponent_user_id <> user_id`),
    index('idx_realtime_duels_user').on(table.userId, table.expiresAt),
    index('idx_realtime_duels_opponent').on(table.opponentUserId, table.expiresAt),
  ],
);

export const realtimeMatchmaking = pgTable(
  'realtime_matchmaking',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    matchId: uuid('match_id'),
    opponentUserId: uuid('opponent_user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '5 minutes'`),
  },
  (table) => [
    check('ck_matchmaking_distinct_players', sql`opponent_user_id IS NULL OR opponent_user_id <> user_id`),
    index('idx_realtime_matchmaking_expiry').on(table.expiresAt),
  ],
);

export const realtimeEventLimits = pgTable(
  'realtime_event_limits',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    minute: timestamp('minute', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
  },
  (table) => [check('ck_realtime_event_limits_count', sql`${table.count} BETWEEN 1 AND 601`)],
);
