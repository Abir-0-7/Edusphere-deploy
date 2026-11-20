import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './schema';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const whiteboards = pgTable(
  'whiteboards',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    revision: integer('revision').notNull().default(1),
    scene: jsonb('scene').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_whiteboards_id_owner').on(table.id, table.userId),
    check('ck_whiteboards_revision', sql`${table.revision} > 0`),
    check('ck_whiteboards_scene_object', sql`jsonb_typeof(${table.scene}) = 'object'`),
    index('idx_whiteboards_user_updated').on(table.userId, table.updatedAt),
  ],
);

export const whiteboardAssets = pgTable(
  'whiteboard_assets',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    boardId: uuid('board_id').notNull(),
    fileId: varchar('file_id', { length: 160 }).notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    data: bytea('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'fk_whiteboard_assets_board_owner',
      columns: [table.boardId, table.userId],
      foreignColumns: [whiteboards.id, whiteboards.userId],
    }).onDelete('cascade'),
    unique('uq_whiteboard_assets_board_file').on(table.boardId, table.userId, table.fileId),
    check('ck_whiteboard_assets_type', sql`${table.mimeType} IN ('image/png','image/jpeg','image/webp')`),
    check('ck_whiteboard_assets_size', sql`${table.sizeBytes} BETWEEN 1 AND 10485760`),
    check('ck_whiteboard_assets_bytes', sql`${table.sizeBytes} = octet_length(${table.data})`),
    check('ck_whiteboard_assets_hash', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    index('idx_whiteboard_assets_owner_board').on(table.userId, table.boardId),
  ],
);
