import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { Redis } from '@upstash/redis';
import { createTokenVerifier } from './auth.js';
import { DuelAnswerInputSchema, DuelJoinInputSchema, DuelStore, type DuelCard } from './duel.js';
import { Matchmaker, MemoryMatchmaking, UpstashMatchmaking, type MatchmakingStore } from './matchmaking.js';
import { z } from 'zod';
import postgres from 'postgres';

export type RealtimeOptions = {
  port?: number;
  jwtVerifier?: (token: string) => Promise<{ id: string }>;
  matchmakingStore?: MatchmakingStore;
  allowedOrigins?: string[];
  loadDuelCards?: (userId: string, cardIds: string[]) => Promise<DuelCard[]>;
};

export function createRealtimeServer(options: RealtimeOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 4100);
  const devMode = process.env.REALTIME_JWT_DEV_MODE === 'true';
  const verify = options.jwtVerifier ?? createTokenVerifier({
    jwksUrl: process.env.REALTIME_JWT_JWKS_URL ?? 'http://localhost/.well-known/jwks.json',
    issuer: process.env.REALTIME_JWT_ISSUER,
    authorizedParties: process.env.REALTIME_JWT_AUTHORIZED_PARTIES?.split(',').filter(Boolean),
    devMode,
  });
  const httpServer = createServer();
  const io = new Server(httpServer, {
    connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: false },
    cors: { origin: options.allowedOrigins ?? process.env.REALTIME_ALLOWED_ORIGIN?.split(',').filter(Boolean) ?? [] },
  });
  const duels = new DuelStore();
  const store = options.matchmakingStore ?? (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new UpstashMatchmaking(new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }))
    : new MemoryMatchmaking());
  const matchmaking = new Matchmaker(store);

  io.use(async (socket, next) => {
    try {
      const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
      socket.data.user = await verify(token);
      next();
    } catch { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user.id as string;
    socket.join(`user:${userId}`);
    socket.on('matchmaking:join', async (ack?: (result: unknown) => void) => {
      try {
        const match = await matchmaking.join(userId);
        if (match) {
          for (const player of match.players) io.to(`user:${player}`).emit('matchmaking:found', match);
        }
        ack?.({ ok: true, matched: Boolean(match) });
      } catch { ack?.({ ok: false, error: 'matchmaking unavailable' }); }
    });
    socket.on('matchmaking:leave', async (ack?: (result: unknown) => void) => {
      await matchmaking.leave(userId);
      ack?.({ ok: true });
    });
    socket.on('duel:create', async (payload: unknown, ack?: (result: unknown) => void) => {
      const parsed = z.object({ cardIds: z.array(z.string().min(1).max(128)).min(1).max(50) }).safeParse(payload);
      if (!parsed.success) { ack?.({ ok: false, error: 'invalid duel payload' }); return; }
      if (!options.loadDuelCards) { ack?.({ ok: false, error: 'flashcard source is not configured' }); return; }
      try {
        const cards = await options.loadDuelCards(userId, parsed.data.cardIds);
        if (cards.length !== parsed.data.cardIds.length) throw new Error('flashcards not found');
        const state = duels.create(cards, userId);
        socket.join(`duel:${state.id}`);
        ack?.({ ok: true, duelId: state.id, state: publicState(state) });
      } catch (error) { ack?.({ ok: false, error: error instanceof Error ? error.message : 'invalid duel' }); }
    });
    socket.on('duel:join', (payload: unknown, ack?: (result: unknown) => void) => {
      const parsed = DuelJoinInputSchema.safeParse(payload);
      if (!parsed.success) { ack?.({ ok: false, error: 'invalid duel payload' }); return; }
      try {
        const state = duels.join(parsed.data.duelId, userId);
        socket.join(`duel:${state.id}`);
        io.to(`duel:${state.id}`).emit('duel:state', publicState(state));
        ack?.({ ok: true });
      } catch (error) { ack?.({ ok: false, error: error instanceof Error ? error.message : 'cannot join' }); }
    });
    socket.on('duel:resume', (payload: unknown, ack?: (result: unknown) => void) => {
      const parsed = DuelJoinInputSchema.safeParse(payload);
      if (!parsed.success) { ack?.({ ok: false, error: 'invalid duel payload' }); return; }
      const state = duels.get(parsed.data.duelId);
      if (!state?.players.has(userId)) { ack?.({ ok: false, error: 'not a duel member' }); return; }
      socket.join(`duel:${state.id}`);
      ack?.({ ok: true, state: publicState(state) });
    });
    socket.on('duel:answer', (payload: unknown, ack?: (result: unknown) => void) => {
      const parsed = DuelAnswerInputSchema.safeParse(payload);
      if (!parsed.success) { ack?.({ ok: false, error: 'invalid answer payload' }); return; }
      try {
        const result = duels.answer(parsed.data.duelId, userId, parsed.data.cardId, parsed.data.answer);
        io.to(`duel:${parsed.data.duelId}`).emit('duel:result', { userId, correct: result.correct, state: publicState(result.state) });
        ack?.({ ok: true, correct: result.correct });
      } catch (error) { ack?.({ ok: false, error: error instanceof Error ? error.message : 'invalid answer' }); }
    });
    socket.on('disconnect', () => { void matchmaking.leave(userId); });
  });

  return { port, io, httpServer, duels, matchmaking };
}

function publicState(state: ReturnType<DuelStore['require']>) {
  return { id: state.id, status: state.status, cards: state.cards.map((card) => ({ id: card.id, prompt: card.prompt })), players: [...state.players.values()].map(({ userId, score }) => ({ userId, score })), currentIndex: state.currentIndex, winner: state.winner };
}

let sql: ReturnType<typeof postgres> | undefined;
async function loadUserDuelCards(clerkUserId: string, cardIds: string[]): Promise<DuelCard[]> {
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

const defaultServer = process.env.NODE_ENV === 'test'
  ? createRealtimeServer({ jwtVerifier: async (token) => ({ id: token || 'test-user' }), loadDuelCards: async (_userId, cardIds) => cardIds.map((id) => ({ id, prompt: 'test', answer: 'test' })) })
  : createRealtimeServer({ loadDuelCards: loadUserDuelCards });
if (process.env.NODE_ENV !== 'test') defaultServer.httpServer.listen(defaultServer.port, () => console.warn(`realtime listening on ${defaultServer.port}`));
export const io = defaultServer.io;
export const httpServer: HttpServer = defaultServer.httpServer;
export const duels = defaultServer.duels;
