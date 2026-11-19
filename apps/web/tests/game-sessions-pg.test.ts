import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GameSessionSchema,
  type GameId,
  type GameSession,
  type VersionedGameAction,
} from '@studyvault/types';
import { getAuthoredQuestion, getGameResult, restoreGame } from '@studyvault/game-engine';
import { POST as createSession } from '../src/app/api/games/sessions/route';
import {
  DELETE as deleteSession,
  GET as readSession,
  POST as commandSession,
} from '../src/app/api/games/sessions/[id]/route';

const testState = vi.hoisted(() => ({ owner: '', nextDatabase: () => null as unknown }));
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: testState.owner }) }));
vi.mock('../src/lib/users', () => ({ getUserByClerkId: async (id: string) => ({ id }) }));
vi.mock('../src/lib/db', () => ({ getDb: () => testState.nextDatabase() }));

// Deliberately no fallback to DATABASE_URL: the normal application database is
// never a permissible test target. Test tables live only in a random schema.
const testDatabaseUrl = process.env.STUDYVAULT_TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('Postgres game-session migration, locking and atomic rewards', () => {
  let admin: ReturnType<typeof postgres> | undefined;
  let firstClient: ReturnType<typeof postgres> | undefined;
  let secondClient: ReturnType<typeof postgres> | undefined;
  let schema = '';
  let alice = '';
  let bob = '';

  beforeEach(async () => {
    schema = `game_session_test_${randomUUID().replaceAll('-', '')}`;
    admin = postgres(testDatabaseUrl!, { prepare: false, max: 1 });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    const options = { prepare: false, max: 4, connection: { search_path: schema } };
    firstClient = postgres(testDatabaseUrl!, options);
    secondClient = postgres(testDatabaseUrl!, options);
    await firstClient.unsafe(`
      CREATE TABLE users (id uuid PRIMARY KEY, clerk_id text NOT NULL UNIQUE);
      CREATE TABLE token_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount integer NOT NULL,
        reason text NOT NULL,
        ref_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_token_ledger_reason_ref UNIQUE(reason, ref_id)
      );
    `);

    // Exercise the real game table/FK/index migration without creating unrelated
    // AI tables or changing the public schema. Only its FK schema is retargeted.
    const migration = await readFile(
      new URL('../../../packages/db/drizzle/0008_game_vault_sessions.sql', import.meta.url),
      'utf8',
    );
    const gameStatements = migration
      .split('--> statement-breakpoint')
      .filter((statement) => statement.includes('"game_sessions"'));
    expect(gameStatements).toHaveLength(3);
    for (const statement of gameStatements) {
      await firstClient.unsafe(statement.replaceAll('"public"."users"', `"${schema}"."users"`));
    }
    alice = randomUUID();
    bob = randomUUID();
    await firstClient`INSERT INTO users (id, clerk_id) VALUES (${alice}, 'alice-game-test'), (${bob}, 'bob-game-test')`;
    const databases = [drizzle(firstClient), drizzle(secondClient)];
    let calls = 0;
    testState.owner = alice;
    testState.nextDatabase = () => databases[calls++ % databases.length];
  });

  afterEach(async () => {
    if (firstClient) await firstClient.end({ timeout: 5 });
    if (secondClient) await secondClient.end({ timeout: 5 });
    if (admin) {
      if (/^game_session_test_[a-f0-9]{32}$/.test(schema))
        await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end({ timeout: 5 });
    }
    admin = undefined;
    firstClient = undefined;
    secondClient = undefined;
  });

  function request(body: unknown): Request {
    return new Request('https://study.test/api/games/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://study.test' },
      body: JSON.stringify(body),
    });
  }
  function context(id: string) {
    return { params: Promise.resolve({ id }) };
  }
  async function create(): Promise<GameSession> {
    const response = await createSession(
      request({ game_id: 'NQueens', difficulty: 'easy', practice: false }),
    );
    expect(response.status).toBe(201);
    return GameSessionSchema.parse(await response.json());
  }
  async function send(id: string, revision: number, row?: number, column?: number) {
    return commandSession(
      request(
        row === undefined
          ? { revision, command: 'start' }
          : { revision, command: 'act', action: { seq: row + 1, action: { type: 'place', row, column } } },
      ),
      context(id),
    );
  }
  async function almostComplete(): Promise<GameSession> {
    const session = await create();
    expect((await send(session.id, 0)).status).toBe(200);
    for (const [row, column] of [
      [0, 1],
      [1, 3],
      [2, 0],
    ])
      expect((await send(session.id, row! + 1, row!, column!)).status).toBe(200);
    return session;
  }

  it('serializes final-action races across database clients and keeps the owner/day payout after save deletion', async () => {
    const session = await almostComplete();
    const completions = await Promise.all(Array.from({ length: 12 }, () => send(session.id, 4, 3, 2)));
    expect(completions.filter((response) => response.status === 200)).toHaveLength(1);
    expect(completions.filter((response) => response.status === 409)).toHaveLength(11);
    const saved = GameSessionSchema.parse(
      await (await readSession(new Request('https://study.test'), context(session.id))).json(),
    );
    expect(saved.status).toBe('won');
    expect(saved.revision).toBe(5);
    expect(saved.tokens_awarded).toBeGreaterThan(0);
    const rewards = await firstClient!<
      { amount: number }[]
    >`SELECT amount FROM token_ledger WHERE user_id = ${alice}`;
    expect(rewards).toHaveLength(1);
    expect(rewards[0]?.amount).toBe(saved.tokens_awarded);
    testState.owner = bob;
    expect((await readSession(new Request('https://study.test'), context(session.id))).status).toBe(404);
    expect((await deleteSession(new Request('https://study.test'), context(session.id))).status).toBe(404);
    testState.owner = alice;
    expect((await deleteSession(new Request('https://study.test'), context(session.id))).status).toBe(204);
    const retry = await almostComplete();
    expect((await send(retry.id, 4, 3, 2)).status).toBe(200);
    const retried = GameSessionSchema.parse(
      await (await readSession(new Request('https://study.test'), context(retry.id))).json(),
    );
    expect(retried.tokens_awarded).toBe(0);
    const [count] = await firstClient!<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM token_ledger WHERE user_id = ${alice}`;
    expect(count?.count).toBe(1);
  });

  it('rolls back a payout on failed session commit, resumes through a new connection, and cascades account deletion', async () => {
    const session = await almostComplete();
    await firstClient!.unsafe(`
      CREATE FUNCTION reject_won_game() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'won' THEN RAISE EXCEPTION 'injected session write failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_won_game BEFORE UPDATE ON game_sessions FOR EACH ROW EXECUTE FUNCTION reject_won_game();
    `);
    expect((await send(session.id, 4, 3, 2)).status).toBe(503);
    const [ledger] = await firstClient!<{ count: number }[]>`SELECT count(*)::int AS count FROM token_ledger`;
    expect(ledger?.count).toBe(0);
    const [persisted] = await secondClient!<
      { revision: number; status: string }[]
    >`SELECT revision, status FROM game_sessions WHERE id = ${session.id}`;
    expect(persisted).toEqual({ revision: 4, status: 'playing' });
    await firstClient!.unsafe('DROP TRIGGER reject_won_game ON game_sessions');
    expect((await send(session.id, 4, 3, 2)).status).toBe(200);

    // Reconstruct the web DB handle using an independent connection. No process
    // state or in-memory session survives; the saved row is the source of truth.
    testState.nextDatabase = () => drizzle(secondClient!);
    const recovered = GameSessionSchema.parse(
      await (await readSession(new Request('https://study.test'), context(session.id))).json(),
    );
    expect(recovered.status).toBe('won');
    await firstClient!`DELETE FROM users WHERE id = ${alice}`;
    const [sessions] = await firstClient!<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM game_sessions`;
    const [rewards] = await firstClient!<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM token_ledger`;
    expect(sessions?.count).toBe(0);
    expect(rewards?.count).toBe(0);
  });

  it('persists every expanded game through the existing schema and settles each owner/game once across clients', async () => {
    const expanded = [
      'DebuggingDetective',
      'SQLDetective',
      'GraphPath',
      'ProofBuilder',
      'DataDetective',
      'AdaptiveQuiz',
      'ExamEscape',
    ] as const satisfies readonly GameId[];
    for (const gameId of expanded) {
      const created = await createSession(request({ game_id: gameId, difficulty: 'easy', practice: false }));
      expect(created.status).toBe(201);
      let session = GameSessionSchema.parse(await created.json());
      const started = await commandSession(request({ revision: 0, command: 'start' }), context(session.id));
      expect(started.status).toBe(200);
      session = GameSessionSchema.parse(await started.json());
      let lastAction: VersionedGameAction | undefined;
      while (getGameResult(restoreGame(session.snapshot)).status === 'playing') {
        const key = getAuthoredQuestion(restoreGame(session.snapshot))!;
        const solution = key.solution;
        lastAction =
          typeof solution?.line === 'number' && typeof solution?.repair === 'number'
            ? { type: 'debug', question_id: key.id, line: solution.line, repair: solution.repair }
            : solution?.node_ids
              ? { type: 'path', question_id: key.id, node_ids: [...solution.node_ids] }
              : solution?.step_ids
                ? { type: 'order', question_id: key.id, step_ids: [...solution.step_ids] }
                : { type: 'answer', question_id: key.id, choice: key.answer };
        const updated = await commandSession(
          request({
            revision: session.revision,
            command: 'act',
            action: { seq: session.snapshot.actions.length + 1, action: lastAction },
          }),
          context(session.id),
        );
        expect(updated.status).toBe(200);
        session = GameSessionSchema.parse(await updated.json());
      }
      expect(session.status).toBe('won');
      expect(session.tokens_awarded).toBeGreaterThan(0);
      expect(session.tokens_awarded).toBeLessThanOrEqual(5);

      // A new independent handle restores all domain-specific actions from JSONB.
      testState.nextDatabase = () => drizzle(secondClient!);
      const restored = GameSessionSchema.parse(
        await (await readSession(new Request('https://study.test'), context(session.id))).json(),
      );
      expect(restored.snapshot).toEqual(session.snapshot);
      expect(restored.status).toBe('won');
      expect(
        (
          await commandSession(
            request({
              revision: session.revision - 1,
              command: 'act',
              action: { seq: session.snapshot.actions.length, action: lastAction },
            }),
            context(session.id),
          )
        ).status,
      ).toBe(409);
      const rewards = await firstClient!<{ amount: number }[]>`
        SELECT amount FROM token_ledger WHERE user_id = ${alice} AND reason LIKE ${`game:${gameId}:%`}
      `;
      expect(rewards).toEqual([{ amount: session.tokens_awarded }]);
    }
    const [totals] = await firstClient!<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM token_ledger WHERE user_id = ${alice}`;
    expect(totals?.count).toBe(expanded.length);
  });
});
