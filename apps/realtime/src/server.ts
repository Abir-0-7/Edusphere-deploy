import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createTokenVerifier } from './auth.js';
import { publicDuel, DuelAnswerInputSchema, DuelJoinInputSchema, type DuelCard } from './duel.js';
import { Matchmaker, MemoryMatchmaking, PostgresMatchmaking, type MatchmakingStore } from './matchmaking.js';
import {
  DurableDuels,
  MemoryDuelRepository,
  PostgresDuelRepository,
  type DuelRepository,
} from './duel-repository.js';
import { z } from 'zod';
import postgres from 'postgres';
import { MemoryEventLimiter, PostgresEventLimiter, type EventLimiter } from './abuse.js';
import { realtimeSettings, type RealtimeSettings } from './settings.js';

export type RealtimeOptions = {
  port?: number;
  jwtVerifier?: (token: string) => Promise<{ id: string }>;
  matchmakingStore?: MatchmakingStore;
  duelRepository?: DuelRepository;
  allowedOrigins?: string[];
  loadDuelCards?: (userId: string, cardIds: string[]) => Promise<DuelCard[]>;
  eventLimiter?: EventLimiter;
  settings?: RealtimeSettings;
  now?: () => number;
};

export function createRealtimeServer(options: RealtimeOptions = {}) {
  const settings = options.settings ?? realtimeSettings();
  const now = options.now ?? Date.now;
  const port = options.port ?? Number(process.env.PORT ?? 4100);
  const devMode = process.env.REALTIME_JWT_DEV_MODE === 'true';
  const verify =
    options.jwtVerifier ??
    createTokenVerifier({
      jwksUrl: process.env.REALTIME_JWT_JWKS_URL ?? 'http://localhost/.well-known/jwks.json',
      issuer: process.env.REALTIME_JWT_ISSUER,
      authorizedParties: process.env.REALTIME_JWT_AUTHORIZED_PARTIES?.split(',').filter(Boolean),
      devMode,
    });
  const httpServer = createServer();
  const io = new Server(httpServer, {
    maxHttpBufferSize: settings.REALTIME_EVENT_MAX_PAYLOAD_BYTES,
    connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: false },
    cors: {
      origin: options.allowedOrigins ?? process.env.REALTIME_ALLOWED_ORIGIN?.split(',').filter(Boolean) ?? [],
    },
  });
  const databaseUrl = process.env.DATABASE_URL;
  const database =
    databaseUrl && (!options.duelRepository || !options.matchmakingStore || !options.eventLimiter)
      ? postgres(databaseUrl, { prepare: false, max: 2, idle_timeout: 20 })
      : undefined;
  const duels = new DurableDuels(
    options.duelRepository ??
      (database
        ? new PostgresDuelRepository(database, settings.REALTIME_MAX_DUELS_PER_USER)
        : process.env.NODE_ENV === 'test'
          ? new MemoryDuelRepository(now, settings.REALTIME_MAX_DUELS_PER_USER)
          : (() => {
              throw new Error('DATABASE_URL is required for durable duels');
            })()),
    now,
    settings.REALTIME_QUESTION_MS,
  );
  const store =
    options.matchmakingStore ??
    (database
      ? new PostgresMatchmaking(database, settings.REALTIME_MAX_QUEUE)
      : process.env.NODE_ENV === 'test'
        ? new MemoryMatchmaking(now, settings.REALTIME_MAX_QUEUE)
        : (() => {
            throw new Error('DATABASE_URL is required for durable matchmaking');
          })());
  const matchmaking = new Matchmaker(store);
  const limiter =
    options.eventLimiter ??
    (database
      ? new PostgresEventLimiter(database, settings.REALTIME_EVENT_LIMIT_PER_MINUTE)
      : new MemoryEventLimiter(settings.REALTIME_EVENT_LIMIT_PER_MINUTE, now));
  const connections = new Map<string, number>();
  const inFlight = new Map<string, number>();

  io.use(async (socket, next) => {
    try {
      const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
      if (!token || token.length > 8192) throw new Error('unauthorized');
      const user = await verify(token);
      if (!user.id || user.id.length > 128) throw new Error('unauthorized');
      if (
        (connections.get(user.id) ?? 0) >= settings.REALTIME_MAX_CONNECTIONS_PER_USER ||
        (connections.size >= 1000 && !connections.has(user.id))
      ) {
        next(new Error('connection capacity reached'));
        return;
      }
      connections.set(user.id, (connections.get(user.id) ?? 0) + 1);
      socket.conn.once('close', () => {
        const remaining = (connections.get(user.id) ?? 1) - 1;
        if (remaining > 0) connections.set(user.id, remaining);
        else connections.delete(user.id);
      });
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user.id as string;
    socket.join(`user:${userId}`);
    type Reply = (result: unknown) => void;
    const on = (name: string, body: (payload: unknown, reply: Reply) => Promise<void>) => {
      socket.on(name, (...args: unknown[]) => {
        const last = args.at(-1);
        const reply: Reply = typeof last === 'function' ? (last as Reply) : () => undefined;
        const payload = typeof args[0] === 'function' ? undefined : args[0];
        void (async () => {
          if ((inFlight.get(userId) ?? 0) >= settings.REALTIME_MAX_IN_FLIGHT_PER_USER) {
            reply({ ok: false, error: 'too many pending events', retryAfter: 1 });
            return;
          }
          inFlight.set(userId, (inFlight.get(userId) ?? 0) + 1);
          try {
            if (!(await limiter.take(userId))) {
              reply({ ok: false, error: 'rate limited', retryAfter: 60 });
              return;
            }
            await body(payload, reply);
          } catch (error) {
            console.warn('Realtime event rejected', {
              event: name,
              reason: error instanceof Error ? error.name : 'UnknownError',
            });
            reply({ ok: false, error: 'realtime operation unavailable' });
          } finally {
            const remaining = (inFlight.get(userId) ?? 1) - 1;
            if (remaining > 0) inFlight.set(userId, remaining);
            else inFlight.delete(userId);
          }
        })();
      });
    };
    on('matchmaking:join', async (_payload, ack) => {
      try {
        const match = await matchmaking.join(userId);
        if (match) {
          for (const player of match.players) io.to(`user:${player}`).emit('matchmaking:found', match);
        }
        ack?.({ ok: true, matched: Boolean(match) });
      } catch {
        ack?.({ ok: false, error: 'matchmaking unavailable' });
      }
    });
    on('matchmaking:leave', async (_payload, ack) => {
      await matchmaking.leave(userId);
      ack?.({ ok: true });
    });
    on('duel:create', async (payload, ack) => {
      const parsed = z
        .object({ cardIds: z.array(z.string().min(1).max(128)).min(1).max(50) })
        .strict()
        .safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false, error: 'invalid duel payload' });
        return;
      }
      if (!options.loadDuelCards) {
        ack?.({ ok: false, error: 'flashcard source is not configured' });
        return;
      }
      try {
        const cards = await options.loadDuelCards(userId, parsed.data.cardIds);
        if (cards.length !== parsed.data.cardIds.length) throw new Error('flashcards not found');
        const state = await duels.create(cards, userId);
        socket.join(`duel:${state.id}`);
        ack?.({ ok: true, duelId: state.id, state: publicDuel(state) });
      } catch {
        ack?.({ ok: false, error: 'could not create duel' });
      }
    });
    on('duel:join', async (payload, ack) => {
      const parsed = DuelJoinInputSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false, error: 'invalid duel payload' });
        return;
      }
      try {
        const state = await duels.join(parsed.data.duelId, userId);
        socket.join(`duel:${state.id}`);
        io.to(`duel:${state.id}`).emit('duel:state', publicDuel(state));
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'cannot join duel' });
      }
    });
    on('duel:resume', async (payload, ack) => {
      const parsed = DuelJoinInputSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false, error: 'invalid duel payload' });
        return;
      }
      let state;
      try {
        state = await duels.resume(parsed.data.duelId, userId);
      } catch {
        ack?.({ ok: false, error: 'cannot resume duel' });
        return;
      }
      socket.join(`duel:${state.id}`);
      ack?.({ ok: true, state: publicDuel(state) });
    });
    on('duel:answer', async (payload, ack) => {
      const parsed = DuelAnswerInputSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false, error: 'invalid answer payload' });
        return;
      }
      try {
        const result = await duels.answer(parsed.data.duelId, userId, parsed.data.cardId, parsed.data.answer);
        io.to(`duel:${parsed.data.duelId}`).emit('duel:result', {
          userId,
          correct: result.correct,
          state: publicDuel(result.state),
        });
        ack?.({ ok: true, correct: result.correct });
      } catch {
        ack?.({ ok: false, error: 'answer rejected' });
      }
    });
    socket.on('disconnect', () => {
      // A second tab/reconnect for this account must not remove its queue entry.
      if (
        [...io.sockets.sockets.values()].some(
          (other) => other.id !== socket.id && other.data.user?.id === userId,
        )
      )
        return;
      void matchmaking.leave(userId).catch((error: unknown) => {
        console.warn('Matchmaking disconnect cleanup unavailable', {
          reason: error instanceof Error ? error.name : 'UnknownError',
        });
      });
    });
  });

  return {
    port,
    io,
    httpServer,
    duels,
    matchmaking,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      if (database) await database.end({ timeout: 5 });
    },
  };
}

let sql: ReturnType<typeof postgres> | undefined;
export async function loadUserDuelCards(clerkUserId: string, cardIds: string[]): Promise<DuelCard[]> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for flashcard duels');
  sql ??= postgres(databaseUrl, { prepare: false, max: 2, idle_timeout: 20 });
  const rows = await sql<{ id: string; front: string; back: string }[]>`
    SELECT f.id, f.front, f.back
    FROM flashcards f
    INNER JOIN users u ON u.id = f.user_id
    WHERE u.clerk_id = ${clerkUserId} AND f.id = ANY(${cardIds}::uuid[])
  `;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return cardIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id: row.id, prompt: row.front, answer: row.back }] : [];
  });
}

export async function closeDuelCardSource(): Promise<void> {
  if (sql) await sql.end({ timeout: 5 });
  sql = undefined;
}
