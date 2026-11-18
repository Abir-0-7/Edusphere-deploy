import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DurableDuels, PostgresDuelRepository } from '../src/duel-repository.js';
import { PostgresEventLimiter } from '../src/abuse.js';
import { PostgresMatchmaking } from '../src/matchmaking.js';

const databaseUrl = process.env.STUDYVAULT_TEST_DATABASE_URL;

/** Runs only against an explicitly supplied disposable test DB. All tables and
 * triggers live in a per-test schema; the application schema is never migrated. */
describe.skipIf(!databaseUrl)('Postgres realtime migration and concurrent durability', () => {
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let otherProcess: ReturnType<typeof postgres>;
  let schema: string;
  let hostId: string;
  let guestId: string;
  let cardId: string;

  beforeEach(async () => {
    schema = `realtime_test_${randomUUID().replaceAll('-', '')}`;
    admin = postgres(databaseUrl!, { prepare: false, max: 1 });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    const options = { prepare: false, max: 4, connection: { search_path: schema } };
    sql = postgres(databaseUrl!, options);
    otherProcess = postgres(databaseUrl!, options);
    await sql.unsafe(`
      CREATE TABLE users (id uuid PRIMARY KEY, clerk_id text NOT NULL UNIQUE);
      CREATE TABLE flashcards (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE token_ledger (id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount integer NOT NULL, reason text NOT NULL, ref_id uuid, UNIQUE(reason, ref_id));
    `);
    const migration = await readFile(
      new URL('../../../packages/db/drizzle/0008_game_vault_sessions.sql', import.meta.url),
      'utf8',
    );
    await sql.unsafe(migration.replaceAll('"public"."users"', `"${schema}"."users"`));
    hostId = randomUUID();
    guestId = randomUUID();
    cardId = randomUUID();
    await sql`INSERT INTO users (id, clerk_id) VALUES (${hostId}, 'host'), (${guestId}, 'guest')`;
    await sql`INSERT INTO flashcards (id, user_id) VALUES (${cardId}, ${hostId})`;
  });

  afterEach(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (otherProcess) await otherProcess.end({ timeout: 5 });
    if (admin) {
      if (/^realtime_test_[a-f0-9]{32}$/.test(schema)) await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end({ timeout: 5 });
    }
  });

  it('replays across two processes, serializes races and writes one settlement per owner', async () => {
    const first = new DurableDuels(new PostgresDuelRepository(sql));
    const restarted = new DurableDuels(new PostgresDuelRepository(otherProcess));
    const duel = await first.create([{ id: cardId, prompt: 'One plus one?', answer: '2' }], 'host');
    await restarted.join(duel.id, 'guest');
    const results = await Promise.allSettled([
      first.answer(duel.id, 'host', cardId, '2'),
      restarted.answer(duel.id, 'host', cardId, '2'),
      restarted.answer(duel.id, 'guest', cardId, '2'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    await Promise.all([first.resume(duel.id, 'host'), restarted.resume(duel.id, 'guest')]);
    const payouts = await sql<{ amount: number }[]>`SELECT amount FROM token_ledger ORDER BY user_id`;
    expect(payouts.map((row) => row.amount)).toEqual([1, 1]);
    expect((await restarted.resume(duel.id, 'host')).status).toBe('finished');
  });

  it('deduplicates durable matchmaking and counter races and purges private source derivatives', async () => {
    const queue = new PostgresMatchmaking(sql);
    const secondQueue = new PostgresMatchmaking(otherProcess);
    await Promise.all([queue.join('host'), secondQueue.join('host')]);
    const match = await secondQueue.join('guest');
    expect(match?.players).toEqual(['host', 'guest']);
    expect((await queue.join('host'))?.id).toBe(match?.id);
    const limiters = [new PostgresEventLimiter(sql, 5), new PostgresEventLimiter(otherProcess, 5)];
    const admitted = await Promise.all(
      Array.from({ length: 16 }, (_, index) => limiters[index % 2]!.take('host')),
    );
    expect(admitted.filter(Boolean)).toHaveLength(5);
    const service = new DurableDuels(new PostgresDuelRepository(sql));
    const duel = await service.create(
      [{ id: cardId, prompt: 'Private prompt', answer: 'Private key' }],
      'host',
    );
    await expect(service.resume(duel.id, 'guest')).rejects.toThrow('not found');
    await sql`DELETE FROM flashcards WHERE id = ${cardId}`;
    await expect(service.resume(duel.id, 'host')).rejects.toThrow('not found');
    await sql`DELETE FROM users WHERE id = ${hostId}`;
    const [counter] = await sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM realtime_event_limits`;
    expect(counter?.count).toBe(0);
  });
});
