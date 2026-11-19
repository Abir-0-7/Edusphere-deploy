import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorEnvelopeSchema,
  GameIdSchema,
  GameSessionSchema,
  GameSessionListSchema,
  type GameId,
  type GameSnapshot,
  type VersionedGameAction,
} from '@studyvault/types';
import {
  applyGame,
  createGame,
  getGameResult,
  getAuthoredQuestion,
  getPublicQuestion,
  questionsFor,
  type GameState,
} from '@studyvault/game-engine';
import { GET as listSessions, POST as createSession } from '../src/app/api/games/sessions/route';
import { GET as readSession, POST as commandSession } from '../src/app/api/games/sessions/[id]/route';

type Row = Record<string, unknown>;
type Table = { name: string };
type Predicate = { kind: 'eq'; column: string; value: unknown } | { kind: 'and'; values: Predicate[] };
type Projection = Record<string, string | { kind: 'count' }>;
type SavedSession = Row & {
  id: string;
  userId: string;
  gameId: GameId;
  snapshot: GameSnapshot;
  status: string;
  revision: number;
  tokensAwarded: number;
  createdAt: Date;
  updatedAt: Date;
};

const testState = vi.hoisted(() => ({
  owner: 'alice' as string | null,
  database: null as unknown,
  authUnavailable: false,
  identityUnavailable: false,
  storeUnavailable: false,
}));
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => {
    if (testState.authUnavailable) throw new Error('private Clerk infrastructure failure');
    return { userId: testState.owner };
  },
}));
vi.mock('../src/lib/users', () => ({
  getUserByClerkId: async (id: string) => {
    if (testState.identityUnavailable) throw new Error('private identity database failure');
    return { id };
  },
}));
vi.mock('../src/lib/db', () => ({
  getDb: () => {
    if (testState.storeUnavailable) throw new Error('private connection configuration failure');
    return testState.database;
  },
}));
vi.mock('@studyvault/db', () => ({
  gameSessions: {
    name: 'sessions',
    id: 'id',
    userId: 'userId',
    updatedAt: 'updatedAt',
    revision: 'revision',
  },
  tokenLedger: { name: 'ledger', amount: 'amount', userId: 'userId', reason: 'reason', refId: 'refId' },
  users: { name: 'users', id: 'id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: (column: string, value: unknown) => ({ kind: 'eq', column, value }),
  and: (...values: Predicate[]) => ({ kind: 'and', values }),
  desc: (column: string) => column,
  count: () => ({ kind: 'count' }),
}));

function matches(row: Row, predicate?: Predicate): boolean {
  if (!predicate) return true;
  return predicate.kind === 'eq'
    ? row[predicate.column] === predicate.value
    : predicate.values.every((entry) => matches(row, entry));
}

/** A transactional route test double. It verifies SQL predicates and unique
 * ledger semantics; real Postgres locking/migration checks remain integration
 * acceptance. Transactions serialize here to model a database row lock. */
class MemoryDatabase {
  sessions: SavedSession[] = [];
  ledger: Row[] = [];
  users: Row[] = [{ id: 'alice' }, { id: 'bob' }];
  writes: string[] = [];
  failLedger = false;
  failUpdate = false;
  failRead = false;
  failCreate = false;
  private sequence = 1;
  private transactionTail: Promise<unknown> = Promise.resolve();

  tableRows(table: Table): Row[] {
    if (table.name === 'sessions') return this.sessions;
    if (table.name === 'ledger') return this.ledger;
    if (table.name === 'users') return this.users;
    throw new Error(`Unexpected table ${table.name}`);
  }

  select(projection?: Projection) {
    if (this.failRead) throw new Error('private query failure');
    const readRows = this.tableRows.bind(this);
    let table: Table;
    let predicate: Predicate | undefined;
    let maximum = Infinity;
    const query = {
      from(value: Table) {
        table = value;
        return query;
      },
      where(value: Predicate) {
        predicate = value;
        return query;
      },
      orderBy() {
        return query;
      },
      limit(value: number) {
        maximum = value;
        return query;
      },
      for() {
        return query;
      },
      then(resolve: (rows: Row[]) => unknown, reject: (cause: unknown) => unknown) {
        try {
          const rows = readRows(table)
            .filter((row) => matches(row, predicate))
            .slice(0, maximum);
          if (projection && Object.values(projection).some((value) => typeof value !== 'string')) {
            return Promise.resolve(resolve([{ value: rows.length }]));
          }
          const result = projection
            ? rows.map((row) =>
                Object.fromEntries(
                  Object.entries(projection).map(([key, column]) => [key, row[column as string]]),
                ),
              )
            : rows;
          return Promise.resolve(resolve(structuredClone(result)));
        } catch (cause) {
          return Promise.resolve(reject(cause));
        }
      },
    };
    return query;
  }

  insert(table: Table) {
    return {
      values: (input: Row) => {
        const write = {
          onConflictDoNothing: () => write,
          returning: async () => {
            if (table.name === 'ledger') {
              if (this.failLedger) throw new Error('ledger unavailable');
              if (this.ledger.some((row) => row.reason === input.reason && row.refId === input.refId))
                return [];
              this.writes.push('ledger');
              this.ledger.push(structuredClone(input));
              return [structuredClone(input)];
            }
            if (table.name !== 'sessions') throw new Error('unexpected insertion');
            if (this.failCreate) throw new Error('private insertion failure');
            this.writes.push('sessions');
            const row = {
              ...input,
              id: `10000000-0000-4000-8000-${String(this.sequence++).padStart(12, '0')}`,
              createdAt: new Date('2026-11-18T00:00:00Z'),
              updatedAt: new Date('2026-11-18T00:00:00Z'),
            } as SavedSession;
            this.sessions.push(row);
            return [structuredClone(row)];
          },
        };
        return write;
      },
    };
  }

  update(table: Table) {
    return {
      set: (input: Row) => ({
        where: (predicate: Predicate) => ({
          returning: async () => {
            if (this.failUpdate) throw new Error('session write unavailable');
            const row = this.tableRows(table).find((entry) => matches(entry, predicate));
            if (!row) return [];
            Object.assign(row, structuredClone(input));
            this.writes.push('update');
            return [structuredClone(row)];
          },
        }),
      }),
    };
  }

  delete(table: Table) {
    return {
      where: (predicate: Predicate) => ({
        returning: async () => {
          const rows = this.tableRows(table);
          const removed = rows.filter((row) => matches(row, predicate));
          for (const row of removed) rows.splice(rows.indexOf(row), 1);
          this.writes.push(`delete:${table.name}`);
          return structuredClone(removed);
        },
      }),
    };
  }

  transaction<T>(callback: (transaction: MemoryDatabase) => Promise<T>): Promise<T> {
    const result = this.transactionTail.then(async () => {
      const before = structuredClone({ sessions: this.sessions, ledger: this.ledger, writes: this.writes });
      try {
        return await callback(this);
      } catch (cause) {
        this.sessions = before.sessions;
        this.ledger = before.ledger;
        this.writes = before.writes;
        throw cause;
      }
    });
    this.transactionTail = result.catch(() => undefined);
    return result;
  }
}

let database: MemoryDatabase;

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
async function created(gameId: GameId = 'SortingRace', practice = false) {
  const response = await createSession(request({ game_id: gameId, difficulty: 'easy', practice }));
  expect(response.status).toBe(201);
  return GameSessionSchema.parse(await response.json());
}
async function command(id: string, revision: number, name: 'start' | 'pause' | 'resume' | 'abandon') {
  return commandSession(request({ revision, command: name }), context(id));
}
async function action(id: string, revision: number, seq: number, value: VersionedGameAction) {
  return commandSession(request({ revision, command: 'act', action: { seq, action: value } }), context(id));
}

function solution(initial: GameState): VersionedGameAction[] {
  let state = initial;
  const moves: VersionedGameAction[] = [];
  function step(value: VersionedGameAction) {
    moves.push(value);
    state = applyGame(state, { seq: state.actions.length + 1, action: value });
  }
  if (state.config.game_id === 'SortingRace') {
    const target = [...state.values].sort((a, b) => a - b);
    for (let index = 0; index < target.length && getGameResult(state).status === 'playing'; index++) {
      if (state.values[index] !== target[index]) {
        step({ type: 'swap', left: index, right: state.values.indexOf(target[index]!, index + 1) });
      }
    }
  } else if (state.config.game_id === 'NQueens') {
    [1, 3, 0, 2].forEach((column, row) => step({ type: 'place', row, column }));
  } else if (state.config.game_id === 'TowersOfHanoi') {
    function hanoi(count: number, from: number, to: number, spare: number): void {
      if (!count) return;
      hanoi(count - 1, from, spare, to);
      step({ type: 'move', from, to });
      hanoi(count - 1, spare, to, from);
    }
    hanoi(state.towers[0]!.length, 0, 2, 1);
  } else {
    while (getGameResult(state).status === 'playing') {
      step(correctQuestionAction(state));
    }
  }
  expect(getGameResult(state).status).toBe('won');
  return moves;
}

function correctQuestionAction(state: GameState): VersionedGameAction {
  const key = getAuthoredQuestion(state)!;
  const solution = key.solution;
  if (typeof solution?.line === 'number' && typeof solution?.repair === 'number')
    return { type: 'debug', question_id: key.id, line: solution.line, repair: solution.repair };
  if (solution?.node_ids) return { type: 'path', question_id: key.id, node_ids: [...solution.node_ids] };
  if (solution?.step_ids) return { type: 'order', question_id: key.id, step_ids: [...solution.step_ids] };
  return { type: 'answer', question_id: key.id, choice: key.answer };
}

const EXPANDED_GAMES = [
  'DebuggingDetective',
  'SQLDetective',
  'GraphPath',
  'ProofBuilder',
  'DataDetective',
  'AdaptiveQuiz',
  'ExamEscape',
] as const satisfies readonly GameId[];

beforeEach(() => {
  testState.owner = 'alice';
  testState.authUnavailable = false;
  testState.identityUnavailable = false;
  testState.storeUnavailable = false;
  database = new MemoryDatabase();
  testState.database = database;
});

describe('owner scoped game session routes', () => {
  const operations = [
    ['list', () => listSessions()],
    ['create', () => createSession(request({ game_id: 'NQueens' }))],
    [
      'read',
      () => readSession(new Request('https://study.test'), context('10000000-0000-4000-8000-000000000001')),
    ],
    ['command', () => command('10000000-0000-4000-8000-000000000001', 0, 'start')],
    [
      'delete',
      async () => {
        const { DELETE } = await import('../src/app/api/games/sessions/[id]/route');
        return DELETE(new Request('https://study.test'), context('10000000-0000-4000-8000-000000000001'));
      },
    ],
  ] as const;

  it.each(operations)(
    'returns a useful shared 503 for %s when the store cannot initialize',
    async (_name, invoke) => {
      testState.storeUnavailable = true;
      const response = await invoke();
      expect(response.status).toBe(503);
      const body = ErrorEnvelopeSchema.parse(await response.json());
      expect(body.error.code).toBe('internal');
      expect(body.error.message).toMatch(/try again|retry|temporarily unavailable/i);
      expect(JSON.stringify(body)).not.toContain('private');
      expect(database.sessions).toEqual([]);
      expect(database.ledger).toEqual([]);
    },
  );

  it.each(operations)(
    'returns 503 rather than signing out the %s caller during an identity outage',
    async (_name, invoke) => {
      for (const failure of ['authUnavailable', 'identityUnavailable'] as const) {
        testState[failure] = true;
        const response = await invoke();
        expect(response.status).toBe(503);
        const body = ErrorEnvelopeSchema.parse(await response.json());
        expect(body.error.code).toBe('internal');
        expect(body.error.message).toMatch(/account.*temporarily unavailable/i);
        expect(JSON.stringify(body)).not.toContain('private');
        testState[failure] = false;
      }
      expect(database.writes).toEqual([]);
    },
  );

  it('handles read and create database failures without returning raw errors or partial saves', async () => {
    const session = await created();
    database.failRead = true;
    for (const response of [
      await listSessions(),
      await readSession(new Request('https://study.test'), context(session.id)),
      await createSession(request({ game_id: 'NQueens' })),
    ]) {
      expect(response.status).toBe(503);
      expect(ErrorEnvelopeSchema.parse(await response.json()).error.code).toBe('internal');
    }
    database.failRead = false;
    database.failCreate = true;
    const createFailure = await createSession(request({ game_id: 'NQueens' }));
    expect(createFailure.status).toBe(503);
    expect(ErrorEnvelopeSchema.parse(await createFailure.json()).error.message).toMatch(/saved.*try again/i);
    expect(database.sessions.map((entry) => entry.id)).toEqual([session.id]);
    expect(database.ledger).toEqual([]);
  });

  it.each<GameId>(['SortingRace', 'NQueens', 'TowersOfHanoi', ...EXPANDED_GAMES])(
    'rejects objective-scoped %s before creating a save',
    async (gameId) => {
      const response = await createSession(request({ game_id: gameId, objective_id: 'python.branching' }));
      expect(response.status).toBe(400);
      expect(ErrorEnvelopeSchema.parse(await response.json()).error.code).toBe('invalid_input');
      expect(database.writes).toEqual([]);
    },
  );

  it('does not misclassify a stored snapshot contract bug as an infrastructure outage', async () => {
    const session = await created();
    database.sessions[0]!.snapshot.config.version = 2 as 1;
    await expect(listSessions()).rejects.toThrow();
    await expect(readSession(new Request('https://study.test'), context(session.id))).rejects.toThrow();
  });

  it('creates a server seeded validated session and returns only the signed-in account sessions', async () => {
    const alice = await created();
    expect(alice.snapshot.config.seed).toBeGreaterThanOrEqual(0);
    expect(alice.snapshot.actions).toEqual([]);
    expect(alice.status).toBe('ready');
    testState.owner = 'bob';
    const bob = await created('CodeTrace');
    const list = GameSessionListSchema.parse(await (await listSessions()).json());
    expect(list.sessions.map((row) => row.id)).toEqual([bob.id]);
    expect((await readSession(new Request('https://study.test'), context(alice.id))).status).toBe(404);
    expect((await command(alice.id, 0, 'start')).status).toBe(404);
    expect(database.sessions.find((row) => row.id === alice.id)?.revision).toBe(0);
  });

  it('rejects missing auth, forged seed/amount, malformed JSON and oversized chunked bodies before writes', async () => {
    testState.owner = null;
    expect((await createSession(request({ game_id: 'SortingRace' }))).status).toBe(401);
    expect((await listSessions()).status).toBe(401);
    testState.owner = 'alice';
    expect(
      (await createSession(request({ game_id: 'SortingRace', seed: 9, tokens_awarded: 999 }))).status,
    ).toBe(400);
    expect((await createSession(request({ game_id: 'not-a-game' }))).status).toBe(400);
    expect(
      (await createSession(request({ game_id: 'SortingRace', objective_id: 'python.branching' }))).status,
    ).toBe(400);
    const malformed = new Request('https://study.test/api/games/sessions', { method: 'POST', body: '{' });
    expect((await createSession(malformed)).status).toBe(400);
    const oversized = new Request('https://study.test/api/games/sessions', {
      method: 'POST',
      body: JSON.stringify({ game_id: 'SortingRace', padding: 'x'.repeat(5000) }),
    });
    expect((await createSession(oversized)).status).toBe(400);
    expect(database.writes).toEqual([]);
  });

  it('rejects invalid IDs and extra command fields with shared error envelopes', async () => {
    const badId = await readSession(new Request('https://study.test'), context('not-a-uuid'));
    expect(badId.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await badId.json()).error.code).toBe('invalid_input');
    const session = await created('CodeTrace');
    const forged = await commandSession(
      request({ revision: 0, command: 'start', score: 999, tokens_awarded: 999 }),
      context(session.id),
    );
    expect(forged.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await forged.json()).error.code).toBe('invalid_input');
    expect(database.sessions[0]?.status).toBe('ready');
    testState.owner = null;
    expect((await readSession(new Request('https://study.test'), context(session.id))).status).toBe(401);
    expect((await command(session.id, 0, 'start')).status).toBe(401);
  });

  it('returns only a derived public view, never answer fields or keys', async () => {
    const session = await created('CodeTrace');
    const raw = await (await readSession(new Request('https://study.test'), context(session.id))).json();
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain('"answer"');
    expect(serialized).not.toContain('"choiceIndex"');
    expect(serialized).not.toContain('"objective_id"');
    expect(session.view.question).toBeTruthy();
    expect(Object.keys(session.view.question ?? {}).sort()).toEqual(['choices', 'id', 'prompt', 'source']);
    expect(session.view.score).toBe(0);
    expect(session.view.correct).toBe(0);
  });

  it.each(EXPANDED_GAMES)(
    'keeps %s private, rejects forged commands and restores the authoritative action after pause',
    async (gameId) => {
      const session = await created(gameId);
      const privateState = createGame(session.snapshot.config);
      const nextAction = correctQuestionAction(privateState);
      expect(session.view.question).not.toBeNull();
      expect(session.view.question?.activity).toBeTruthy();
      const publicPayload = JSON.stringify(session);
      expect(publicPayload).not.toContain('"solution":');
      expect(publicPayload).not.toContain('"answer":');
      expect(publicPayload).not.toContain('"dependencies":');
      testState.owner = 'bob';
      expect((await readSession(new Request('https://study.test'), context(session.id))).status).toBe(404);
      expect((await command(session.id, 0, 'start')).status).toBe(404);
      expect(GameSessionListSchema.parse(await (await listSessions()).json()).sessions).toEqual([]);
      testState.owner = 'alice';

      const forged = await commandSession(
        request({ revision: 0, command: 'start', won: true, tokens_awarded: 999 }),
        context(session.id),
      );
      expect(forged.status).toBe(400);
      expect((await command(session.id, 0, 'start')).status).toBe(200);
      expect((await action(session.id, 1, 2, nextAction)).status).toBe(400);
      expect((await action(session.id, 1, 1, { type: 'swap', left: 0, right: 1 })).status).toBe(400);
      expect((await command(session.id, 1, 'pause')).status).toBe(200);
      expect((await action(session.id, 2, 1, nextAction)).status).toBe(400);
      expect((await command(session.id, 2, 'resume')).status).toBe(200);
      expect((await action(session.id, 3, 1, nextAction)).status).toBe(200);
      expect((await action(session.id, 3, 1, nextAction)).status).toBe(409);

      const restored = GameSessionSchema.parse(
        await (await readSession(new Request('https://study.test'), context(session.id))).json(),
      );
      expect(restored.snapshot.actions).toEqual([{ seq: 1, action: nextAction }]);
      expect(restored.view.correct).toBe(1);
      expect(restored.view.feedback?.correct).toBe(true);
      expect(restored.revision).toBe(4);
      expect(database.ledger).toEqual([]);
    },
  );

  it.each(['DebuggingDetective', 'GraphPath', 'ProofBuilder'] as const)(
    'requires the domain action for %s rather than accepting a generic answer index',
    async (gameId) => {
      const session = await created(gameId);
      await command(session.id, 0, 'start');
      const response = await action(session.id, 1, 1, {
        type: 'answer',
        question_id: session.view.question!.id,
        choice: 0,
      });
      expect(response.status).toBe(400);
      expect(database.sessions[0]?.snapshot.actions).toEqual([]);
      expect(database.sessions[0]?.revision).toBe(1);
      expect(database.ledger).toEqual([]);
    },
  );

  it.each(
    (['ConceptMatch', 'RetrievalSprint', 'CodeTrace', 'FlashcardTowerDefense'] as const).flatMap((gameId) =>
      (['python.arithmetic', 'python.collections', 'python.iteration', 'python.branching'] as const).map(
        (objective) => ({ gameId, objective }),
      ),
    ),
  )('creates a nonempty $gameId session scoped to $objective', async ({ gameId, objective }) => {
    const response = await createSession(
      request({
        game_id: gameId,
        difficulty: 'easy',
        practice: true,
        objective_id: objective,
      }),
    );
    expect(response.status).toBe(201);
    const session = GameSessionSchema.parse(await response.json());
    expect(session.snapshot.config.objective_id).toBe(objective);
    expect(session.view.question).not.toBeNull();
    const matching = questionsFor(session.snapshot.config);
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.every((question) => question.objective_id === objective)).toBe(true);
    expect(matching.some((question) => question.id === session.view.question?.id)).toBe(true);
    expect(Object.hasOwn(session.view.question ?? {}, 'answer')).toBe(false);
    expect((await command(session.id, 0, 'start')).status).toBe(200);
    const question = session.view.question!;
    const correct = matching.find((entry) => entry.id === question.id)!;
    const answered = await action(session.id, 1, 1, {
      type: 'answer',
      question_id: question.id,
      choice: correct.answer,
    });
    expect(answered.status).toBe(200);
    const updated = GameSessionSchema.parse(await answered.json());
    expect(updated.view.feedback?.correct).toBe(true);
    expect(updated.view.feedback?.question_id).toBe(question.id);
    expect(updated.view.correct).toBe(1);
  });

  it('enforces the account session cap without taking another account capacity', async () => {
    const session = await created();
    const row = database.sessions[0]!;
    database.sessions = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(row),
      id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    expect((await createSession(request({ game_id: session.snapshot.config.game_id }))).status).toBe(429);
    testState.owner = 'bob';
    expect((await createSession(request({ game_id: 'SortingRace' }))).status).toBe(201);
  });

  it('persists pause/resume and rejects stale, repeated, malformed, out-of-order and paused actions', async () => {
    const session = await created();
    expect((await command(session.id, 0, 'pause')).status).toBe(400);
    expect((await command(session.id, 0, 'start')).status).toBe(200);
    expect((await command(session.id, 1, 'start')).status).toBe(400);
    expect((await command(session.id, 0, 'abandon')).status).toBe(409);
    expect((await action(session.id, 1, 2, { type: 'swap', left: 0, right: 1 })).status).toBe(400);
    expect((await command(session.id, 1, 'pause')).status).toBe(200);
    expect((await action(session.id, 2, 1, { type: 'swap', left: 0, right: 1 })).status).toBe(400);
    const restored = GameSessionSchema.parse(
      await (await readSession(new Request('https://study.test'), context(session.id))).json(),
    );
    expect(restored.status).toBe('paused');
    expect(restored.snapshot.actions).toEqual([]);
    expect((await command(session.id, 2, 'resume')).status).toBe(200);
    expect((await action(session.id, 3, 1, { type: 'swap', left: 0, right: 1 })).status).toBe(200);
    expect((await action(session.id, 3, 1, { type: 'swap', left: 0, right: 1 })).status).toBe(409);
    const bad = request({
      revision: 4,
      command: 'act',
      action: { seq: 2, action: { type: 'swap', left: 0, right: 999 } },
    });
    expect((await commandSession(bad, context(session.id))).status).toBe(400);
    expect(database.sessions[0]?.revision).toBe(4);
    expect(database.sessions[0]?.snapshot.actions).toHaveLength(1);
  });

  it.each<GameId>(GameIdSchema.options)(
    'settles %s once after server replay and caps same-day retry rewards',
    async (gameId) => {
      const session = await created(gameId);
      const moves = solution(createGame(session.snapshot.config));
      await command(session.id, 0, 'start');
      for (let index = 0; index < moves.length - 1; index++) {
        expect((await action(session.id, index + 1, index + 1, moves[index]!)).status).toBe(200);
      }
      const last = moves.at(-1)!;
      const replies = await Promise.all(
        Array.from({ length: 8 }, () => action(session.id, moves.length, moves.length, last)),
      );
      expect(replies.filter((reply) => reply.status === 200)).toHaveLength(1);
      expect(replies.filter((reply) => reply.status === 409)).toHaveLength(7);
      const completed = GameSessionSchema.parse(
        await (await readSession(new Request('https://study.test'), context(session.id))).json(),
      );
      expect(completed.status).toBe('won');
      expect(completed.tokens_awarded).toBeGreaterThan(0);
      expect(completed.tokens_awarded).toBeLessThanOrEqual(5);
      expect(database.ledger).toHaveLength(1);
      const wonCount = GameSessionListSchema.parse(await (await listSessions()).json()).progression[gameId];
      expect(wonCount).toBe(1);
      const retry = await created(gameId);
      const retryMoves = solution(createGame(retry.snapshot.config));
      await command(retry.id, 0, 'start');
      for (let index = 0; index < retryMoves.length; index++)
        await action(retry.id, index + 1, index + 1, retryMoves[index]!);
      expect(database.ledger).toHaveLength(1);
      expect(database.sessions.find((row) => row.id === retry.id)?.tokensAwarded).toBe(0);
    },
  );

  it.each<GameId>(['RetrievalSprint', ...EXPANDED_GAMES])(
    'preserves a complete %s practice journey without a token or scheduled-review write',
    async (gameId) => {
      const session = await created(gameId, true);
      const moves = solution(createGame(session.snapshot.config));
      await command(session.id, 0, 'start');
      for (let index = 0; index < moves.length; index++)
        await action(session.id, index + 1, index + 1, moves[index]!);
      const completed = database.sessions[0]!;
      expect(completed.status).toBe('won');
      expect(completed.tokensAwarded).toBe(0);
      expect(database.ledger).toEqual([]);
      expect(database.writes.every((table) => table === 'sessions' || table === 'update')).toBe(true);
    },
  );

  it('makes terminal sessions immutable and abandoning grants no reward', async () => {
    const session = await created('CodeTrace');
    expect((await command(session.id, 0, 'abandon')).status).toBe(200);
    expect((await command(session.id, 1, 'start')).status).toBe(400);
    expect((await command(session.id, 1, 'resume')).status).toBe(400);
    expect(
      (await action(session.id, 1, 1, { type: 'answer', question_id: 'trace-add', choice: 1 })).status,
    ).toBe(400);
    expect(database.ledger).toEqual([]);
    expect(database.sessions[0]?.revision).toBe(1);
  });

  it.each<GameId>(['ConceptMatch', 'RetrievalSprint', 'CodeTrace', 'FlashcardTowerDefense'])(
    'records a %s loss without reward and keeps response feedback grounded',
    async (gameId) => {
      const session = await created(gameId);
      await command(session.id, 0, 'start');
      let state = createGame(session.snapshot.config);
      for (let index = 0; index < 3; index++) {
        const question = getPublicQuestion(state)!;
        const key = questionsFor(state.config).find((entry) => entry.id === question.id)!;
        const wrong: VersionedGameAction = {
          type: 'answer',
          question_id: question.id,
          choice: (key.answer + 1) % question.choices.length,
        };
        const response = await action(session.id, index + 1, index + 1, wrong);
        expect(response.status).toBe(200);
        const saved = GameSessionSchema.parse(await response.json());
        state = applyGame(state, { seq: index + 1, action: wrong });
        expect(state.feedback?.question_id).toBe(question.id);
        expect(state.feedback?.source.url).toMatch(/^https:\/\/docs\.python\.org\//);
        expect(saved.snapshot.actions.at(-1)?.action).toEqual(wrong);
      }
      expect(database.sessions[0]?.status).toBe('lost');
      expect(database.sessions[0]?.tokensAwarded).toBe(0);
      expect(database.ledger).toEqual([]);
      expect((await command(session.id, 4, 'start')).status).toBe(400);
    },
  );

  it('does not consume a final action when the durable reward ledger is unavailable', async () => {
    const session = await created('NQueens');
    const moves = solution(createGame(session.snapshot.config));
    await command(session.id, 0, 'start');
    for (let index = 0; index < moves.length - 1; index++)
      await action(session.id, index + 1, index + 1, moves[index]!);
    database.failLedger = true;
    const unavailable = await action(session.id, moves.length, moves.length, moves.at(-1)!);
    expect(unavailable.status).toBe(503);
    expect(ErrorEnvelopeSchema.parse(await unavailable.json()).error.code).toBe('internal');
    expect(database.sessions[0]?.status).toBe('playing');
    expect(database.sessions[0]?.revision).toBe(moves.length);
    expect(database.sessions[0]?.snapshot.actions).toHaveLength(moves.length - 1);
    expect(database.ledger).toEqual([]);
  });

  it('deletes only the caller-owned saved session and preserves earned ledger rewards', async () => {
    const session = await created('SortingRace');
    const moves = solution(createGame(session.snapshot.config));
    await command(session.id, 0, 'start');
    for (let index = 0; index < moves.length; index++)
      await action(session.id, index + 1, index + 1, moves[index]!);
    const ledgerBefore = structuredClone(database.ledger);
    const { DELETE: deleteSession } = await import('../src/app/api/games/sessions/[id]/route');
    const deleted = await deleteSession(new Request('https://study.test'), context(session.id));
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe('');
    expect(database.sessions).toEqual([]);
    expect(database.ledger).toEqual(ledgerBefore);
    expect((await readSession(new Request('https://study.test'), context(session.id))).status).toBe(404);
    expect((await deleteSession(new Request('https://study.test'), context(session.id))).status).toBe(404);
  });

  it('rejects saved-session deletion for invalid IDs, unauthenticated callers, and foreign owners', async () => {
    const session = await created();
    const { DELETE: deleteSession } = await import('../src/app/api/games/sessions/[id]/route');
    expect((await deleteSession(new Request('https://study.test'), context('bad-id'))).status).toBe(400);
    testState.owner = 'bob';
    expect((await deleteSession(new Request('https://study.test'), context(session.id))).status).toBe(404);
    testState.owner = null;
    expect((await deleteSession(new Request('https://study.test'), context(session.id))).status).toBe(401);
    expect(database.sessions).toHaveLength(1);
    expect(database.ledger).toEqual([]);
  });

  it('frees one saved-session capacity slot without resetting daily reward settlement', async () => {
    const session = await created('NQueens');
    const moves = solution(createGame(session.snapshot.config));
    await command(session.id, 0, 'start');
    for (let index = 0; index < moves.length; index++)
      await action(session.id, index + 1, index + 1, moves[index]!);
    const ledgerBefore = structuredClone(database.ledger);
    const wonRow = structuredClone(database.sessions[0]!);
    database.sessions = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(wonRow),
      id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    expect((await createSession(request({ game_id: 'NQueens' }))).status).toBe(429);
    const { DELETE: deleteSession } = await import('../src/app/api/games/sessions/[id]/route');
    expect(
      (await deleteSession(new Request('https://study.test'), context(database.sessions[0]!.id))).status,
    ).toBe(204);
    expect(database.ledger).toEqual(ledgerBefore);
    const retry = await created('NQueens');
    expect(database.sessions).toHaveLength(100);
    await command(retry.id, 0, 'start');
    const retryMoves = solution(createGame(retry.snapshot.config));
    for (let index = 0; index < retryMoves.length; index++)
      await action(retry.id, index + 1, index + 1, retryMoves[index]!);
    expect(database.ledger).toEqual(ledgerBefore);
    expect(database.sessions.find((entry) => entry.id === retry.id)?.tokensAwarded).toBe(0);
  });

  it('rolls back payout if the session commit fails, preserving a retryable final action', async () => {
    const session = await created('NQueens');
    const moves = solution(createGame(session.snapshot.config));
    await command(session.id, 0, 'start');
    for (let index = 0; index < moves.length - 1; index++)
      await action(session.id, index + 1, index + 1, moves[index]!);
    database.failUpdate = true;
    const unavailable = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await action(session.id, moves.length, moves.length, moves.at(-1)!)).status).toBe(503);
    unavailable.mockRestore();
    expect(database.ledger).toEqual([]);
    expect(database.sessions[0]?.status).toBe('playing');
    expect(database.sessions[0]?.revision).toBe(moves.length);
    database.failUpdate = false;
    expect((await action(session.id, moves.length, moves.length, moves.at(-1)!)).status).toBe(200);
    expect(database.ledger).toHaveLength(1);
  });
});
