import { io as createClient, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createRealtimeServer } from '../src/server.js';
import type { DuelCard } from '../src/duel.js';
import type { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';

const running: Array<{ io: Server; httpServer: HttpServer }> = [];

async function startServer() {
  const server = createRealtimeServer({
    port: 0,
    jwtVerifier: async (token) => {
      if (!token.startsWith('valid:')) throw new Error('unauthorized');
      return { id: token.slice('valid:'.length) };
    },
    loadDuelCards: async (userId, cardIds): Promise<DuelCard[]> => cardIds.map((id) => ({ id, prompt: `prompt-${userId}`, answer: 'correct' })),
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
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitAck<T>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out: ${event}`)), 2_000);
    const acknowledge = (result: T) => { clearTimeout(timer); resolve(result); };
    if (payload === undefined) socket.emit(event, acknowledge);
    else socket.emit(event, payload, acknowledge);
  });
}

afterEach(async () => {
  await Promise.all(running.splice(0).map(({ io }) => new Promise<void>((resolve) => io.close(() => resolve()))));
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
    const firstFound = new Promise<{ players: string[] }>((resolve) => first.once('matchmaking:found', resolve));
    await expect(emitAck<{ matched: boolean }>(first, 'matchmaking:join')).resolves.toMatchObject({ matched: false });
    await expect(emitAck<{ matched: boolean }>(second, 'matchmaking:join')).resolves.toMatchObject({ matched: true });
    await expect(firstFound).resolves.toMatchObject({ players: ['first', 'second'] });
    first.disconnect(); second.disconnect();
    const leaving = await connect(server.url, 'valid:leaving');
    await emitAck(leaving, 'matchmaking:join');
    leaving.disconnect();
    const arriving = await connect(server.url, 'valid:arriving');
    await expect(emitAck<{ matched: boolean }>(arriving, 'matchmaking:join')).resolves.toMatchObject({ matched: false });
    arriving.disconnect();
  });

  it('validates duel creation, hides answer keys, authorizes members and supports resume', async () => {
    const server = await startServer();
    const host = await connect(server.url, 'valid:host');
    const guest = await connect(server.url, 'valid:guest');
    const stranger = await connect(server.url, 'valid:stranger');
    const bad = await emitAck<{ ok: boolean }>(host, 'duel:create', { cards: [{ id: 'c', prompt: 'q', answer: 'secret' }] });
    expect(bad.ok).toBe(false);
    const created = await emitAck<{ ok: boolean; duelId: string; state: { cards: Array<Record<string, unknown>> } }>(host, 'duel:create', { cardIds: ['c'] });
    expect(created.ok).toBe(true);
    expect(created.state.cards[0]).not.toHaveProperty('answer');
    const denied = await emitAck<{ ok: boolean }>(stranger, 'duel:resume', { duelId: created.duelId });
    expect(denied.ok).toBe(false);
    expect((await emitAck<{ ok: boolean }>(guest, 'duel:join', { duelId: created.duelId })).ok).toBe(true);
    const answer = await emitAck<{ ok: boolean; correct: boolean }>(host, 'duel:answer', { duelId: created.duelId, cardId: 'c', answer: 'correct' });
    expect(answer).toEqual({ ok: true, correct: true });
    const duplicate = await emitAck<{ ok: boolean }>(host, 'duel:answer', { duelId: created.duelId, cardId: 'c', answer: 'correct' });
    expect(duplicate.ok).toBe(false);
    expect((await emitAck<{ ok: boolean }>(host, 'duel:resume', { duelId: created.duelId })).ok).toBe(true);
    host.disconnect(); guest.disconnect(); stranger.disconnect();
  });
});
