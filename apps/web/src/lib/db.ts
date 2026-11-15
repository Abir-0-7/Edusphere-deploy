import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '@/env';

/**
 * Lazy singleton Drizzle client. Created on first use so the module can be
 * imported during `next build` (where DATABASE_URL may be absent) without
 * throwing — the query only runs at request time.
 */
let _client: ReturnType<typeof postgres> | undefined;
let _db: ReturnType<typeof drizzle> | undefined;

function getClient() {
  _client ??= postgres(getEnv().DATABASE_URL, { prepare: false });
  return _client;
}

export function getDb() {
  _db ??= drizzle(getClient());
  return _db;
}
