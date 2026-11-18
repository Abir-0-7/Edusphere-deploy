import { io as createClient, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createRealtimeServer, type RealtimeOptions } from '../src/server.js';
import type { DuelCard } from '../src/duel.js';
import { MemoryDuelRepository } from '../src/duel-repository.js';
import { MemoryMatchmaking } from '../src/matchmaking.js';
import { MemoryEventLimiter } from '../src/abuse.js';
import { realtimeSettings } from '../src/settings.js';

const running: Array<ReturnType<typeof createRealtimeServer>> = [];
const clients: Socket[] = [];

async function startServer(options: Partial<RealtimeOptions> = {}) {
  const server = createRealtimeServer({
    port: 0,
    jwtVerifier: async (token) => {
      if (!token.startsWith('valid:')) throw new Error('unauthorized');
      return { id: token.slice('valid:'.length) };
    },
    loadDuelCards: async (userId, cardIds): Promise<DuelCard[]> =>
      cardIds.map((id) => ({ id, prompt: `prompt-${userId}`, answer: 'correct' })),
    duelRepository: new MemoryDuelRepository(),
    matchmakingStore: new MemoryMatchmaking(),
    eventLimiter: new MemoryEventLimiter(),
    ...options,
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  running.push(server);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
  return { ...server, url: `http://127.0.0.1:${address.port}` };
}

function connect(url: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, { auth: { token }, reconnection: false, timeout: 2_000 });
    clients.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => {
      socket.disconnect();
      reject(error);
    });
  });
}

function emitAck<T>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out: ${event}`)), 2_000);
    const acknowledge = (result: T) => {
      clearTimeout(timer);
      resolve(result);
    };
    if (payload === undefined) socket.emit(event, acknowledge);
    else socket.emit(event, payload, acknowledge);
  });
}

afterEach(async () => {
  clients.splice(0).forEach((client) => client.disconnect());
  await Promise.all(running.splice(0).map((server) => server.close()));
});

describe('realtime socket boundary', () => {
  it('rejects a missing/invalid JWT on connect', async () => {
    const server = await startServer();
    await expect(connect(server.url, 'invalid')).rejects.toThrow('unauthorized');
  });

  it('matches two authenticated users and removes disconnected users from the queue', async () => {
    const server = await startServer();
    const first = await connect(server.url, 'valid:first');
    const second = await connect(server.url, 'valid:second');
    const firstFound = new Promise<{ players: string[] }>((resolve) =>
      first.once('matchmaking:found', resolve),
    );
    await expect(emitAck<{ matched: boolean }>(first, 'matchmaking:join')).resolves.toMatchObject({
      matched: false,
    });
    await expect(emitAck<{ matched: boolean }>(second, 'matchmaking:join')).resolves.toMatchObject({
      matched: true,
    });
    await expect(firstFound).resolves.toMatchObject({ players: ['first', 'second'] });
    first.disconnect();
    second.disconnect();
    const leaving = await connect(server.url, 'valid:leaving');
    await emitAck(leaving, 'matchmaking:join');
    leaving.disconnect();
    const arriving = await connect(server.url, 'valid:arriving');
    await expect(emitAck<{ matched: boolean }>(arriving, 'matchmaking:join')).resolves.toMatchObject({
      matched: false,
    });
    arriving.disconnect();
  });

  it('validates duel creation, hides answer keys, authorizes members and supports resume', async () => {
    const server = await startServer();
    const host = await connect(server.url, 'valid:host');
    const guest = await connect(server.url, 'valid:guest');
    const stranger = await connect(server.url, 'valid:stranger');
    const bad = await emitAck<{ ok: boolean }>(host, 'duel:create', {
      cards: [{ id: 'c', prompt: 'q', answer: 'secret' }],
    });
    expect(bad.ok).toBe(false);
    const created = await emitAck<{
      ok: boolean;
      duelId: string;
      state: { cards: Array<Record<string, unknown>> };
    }>(host, 'duel:create', { cardIds: ['c'] });
    expect(created.ok).toBe(true);
    expect(created.state.cards[0]).not.toHaveProperty('answer');
    const denied = await emitAck<{ ok: boolean }>(stranger, 'duel:resume', { duelId: created.duelId });
    expect(denied.ok).toBe(false);
    expect((await emitAck<{ ok: boolean }>(guest, 'duel:join', { duelId: created.duelId })).ok).toBe(true);
    const answer = await emitAck<{ ok: boolean; correct: boolean }>(host, 'duel:answer', {
      duelId: created.duelId,
      cardId: 'c',
      answer: 'correct',
    });
    expect(answer).toEqual({ ok: true, correct: true });
    const duplicate = await emitAck<{ ok: boolean }>(host, 'duel:answer', {
      duelId: created.duelId,
      cardId: 'c',
      answer: 'correct',
    });
    expect(duplicate.ok).toBe(false);
    expect((await emitAck<{ ok: boolean }>(host, 'duel:resume', { duelId: created.duelId })).ok).toBe(true);
    host.disconnect();
    guest.disconnect();
    stranger.disconnect();
  });

  it('preserves a two-player session after disconnect and process reconstruction, settles once and keeps its deadline', async () => {
    let now = Date.UTC(2026, 10, 18);
    const repository = new MemoryDuelRepository(() => now);
    const store = new MemoryMatchmaking(() => now);
    const limiter = new MemoryEventLimiter(120, () => now);
    const options = {
      duelRepository: repository,
      matchmakingStore: store,
      eventLimiter: limiter,
      now: () => now,
    };
    const first = await startServer(options);
    const host = await connect(first.url, 'valid:host');
    const guest = await connect(first.url, 'valid:guest');
    const created = await emitAck<{ duelId: string }>(host, 'duel:create', { cardIds: ['c'] });
    await emitAck(guest, 'duel:join', { duelId: created.duelId });
    await emitAck(host, 'duel:answer', { duelId: created.duelId, cardId: 'c', answer: 'correct' });
    const before = await emitAck<{ state: { deadlineAt: number } }>(host, 'duel:resume', {
      duelId: created.duelId,
    });
    host.disconnect();
    guest.disconnect();
    await first.close();
    running.splice(running.indexOf(first), 1);
    now += 1000;
    const second = await startServer(options);
    const resumedHost = await connect(second.url, 'valid:host');
    const resumedGuest = await connect(second.url, 'valid:guest');
    const resumed = await emitAck<{
      ok: boolean;
      state: { deadlineAt: number; players: Array<{ score: number }> };
    }>(resumedHost, 'duel:resume', { duelId: created.duelId });
    expect(resumed).toMatchObject({ ok: true, state: { deadlineAt: before.state.deadlineAt } });
    expect(resumed.state.players.map((player) => player.score)).toEqual([1, 0]);
    expect(
      (
        await emitAck<{ ok: boolean }>(resumedHost, 'duel:answer', {
          duelId: created.duelId,
          cardId: 'c',
          answer: 'correct',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await emitAck<{ ok: boolean }>(resumedGuest, 'duel:answer', {
          duelId: created.duelId,
          cardId: 'c',
          answer: 'wrong',
        })
      ).ok,
    ).toBe(true);
    const finished = await emitAck<{
      state: { status: string; players: Array<{ userId: string; tokensAwarded: number }> };
    }>(resumedHost, 'duel:resume', { duelId: created.duelId });
    expect(finished.state.status).toBe('finished');
    expect(finished.state.players.find((player) => player.userId === 'host')?.tokensAwarded).toBe(1);
    await emitAck(resumedHost, 'duel:resume', { duelId: created.duelId });
    expect([...repository.rewards.values()]).toEqual([1]);
  });

  it('does not reset a deadline on reconnect and rejects a late answer without awarding knowledge', async () => {
    let now = Date.UTC(2026, 10, 18);
    const server = await startServer({ now: () => now, duelRepository: new MemoryDuelRepository(() => now) });
    const host = await connect(server.url, 'valid:host');
    const guest = await connect(server.url, 'valid:guest');
    const created = await emitAck<{ duelId: string }>(host, 'duel:create', { cardIds: ['c'] });
    await emitAck(guest, 'duel:join', { duelId: created.duelId });
    guest.disconnect();
    now += 30001;
    const returnedGuest = await connect(server.url, 'valid:guest');
    expect(
      (
        await emitAck<{ ok: boolean }>(returnedGuest, 'duel:answer', {
          duelId: created.duelId,
          cardId: 'c',
          answer: 'correct',
        })
      ).ok,
    ).toBe(false);
    const finished = await emitAck<{
      state: { status: string; deadlineAt: null; players: Array<{ score: number; tokensAwarded: number }> };
    }>(host, 'duel:resume', { duelId: created.duelId });
    expect(finished.state).toMatchObject({ status: 'finished', deadlineAt: null });
    expect(finished.state.players.every((player) => player.score === 0 && player.tokensAwarded === 0)).toBe(
      true,
    );
  });

  it('bounds account events across two sockets and reconnects', async () => {
    const server = await startServer({ eventLimiter: new MemoryEventLimiter(2) });
    const first = await connect(server.url, 'valid:same');
    const second = await connect(server.url, 'valid:same');
    await emitAck(first, 'matchmaking:join');
    await emitAck(second, 'matchmaking:leave');
    first.disconnect();
    const reconnected = await connect(server.url, 'valid:same');
    await expect(emitAck(reconnected, 'matchmaking:join')).resolves.toMatchObject({
      ok: false,
      error: 'rate limited',
      retryAfter: 60,
    });
  });

  it('bounds per-account socket count and handles async store failures with an acknowledgement', async () => {
    const server = await startServer({
      settings: realtimeSettings({ REALTIME_MAX_CONNECTIONS_PER_USER: '1' }),
      matchmakingStore: {
        join: async () => {
          throw new Error('store down');
        },
        remove: async () => {
          throw new Error('store down');
        },
      },
    });
    const first = await connect(server.url, 'valid:same');
    await expect(connect(server.url, 'valid:same')).rejects.toThrow('connection capacity reached');
    await expect(emitAck(first, 'matchmaking:leave')).resolves.toMatchObject({
      ok: false,
      error: 'realtime operation unavailable',
    });
    first.disconnect();
  });

  it('disconnects oversized packets before they reach gameplay', async () => {
    const server = await startServer({
      settings: realtimeSettings({ REALTIME_EVENT_MAX_PAYLOAD_BYTES: '2048' }),
    });
    const host = await connect(server.url, 'valid:host');
    const disconnected = new Promise<string>((resolve) => host.once('disconnect', resolve));
    host.emit('duel:create', { cardIds: ['x'.repeat(10000)] });
    await expect(disconnected).resolves.toMatch(/^transport (?:close|error)$/);
  });
});
