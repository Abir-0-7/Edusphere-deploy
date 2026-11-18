import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGameSession,
  deleteGameSession,
  listGameSessions,
  loadGameSession,
  sendGameCommand,
} from '../src/lib/game-client';

const session = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  revision: 2,
  snapshot: {
    config: { version: 1, game_id: 'SortingRace', difficulty: 'easy', seed: 31, practice: false },
    actions: [{ seq: 1, action: { type: 'swap', left: 0, right: 1 } }],
  },
  view: {
    values: [-1, 2, 2, 0],
    columns: [-1, -1, -1, -1],
    towers: [[3, 2, 1], [], []],
    question: null,
    feedback: null,
    correct: 0,
    mistakes: 0,
    hints: 0,
    score: 975,
    explanation: 'Keep going.',
  },
  status: 'playing',
  tokens_awarded: 0,
  updated_at: '2026-11-18T00:00:00Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('Game Vault API client', () => {
  it('creates an owner-scoped session from the selected game settings', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...session,
            revision: 0,
            snapshot: { ...session.snapshot, actions: [] },
            status: 'ready',
          }),
          { status: 201 },
        ),
    );
    vi.stubGlobal('fetch', fetch);

    const created = await createGameSession({ game_id: 'SortingRace', difficulty: 'easy', practice: false });

    expect(created.status).toBe('ready');
    expect(fetch).toHaveBeenCalledWith(
      '/api/games/sessions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ game_id: 'SortingRace', difficulty: 'easy', practice: false }),
      }),
    );
  });

  it('loads and validates saved session and progression responses', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(session)))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessions: [session],
            progression: {
              SortingRace: 3,
              NQueens: 0,
              TowersOfHanoi: 0,
              FlashcardTowerDefense: 0,
              ConceptMatch: 0,
              RetrievalSprint: 0,
              CodeTrace: 0,
            },
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(loadGameSession(session.id)).resolves.toMatchObject({ id: session.id, revision: 2 });
    await expect(listGameSessions()).resolves.toMatchObject({
      progression: expect.objectContaining({ SortingRace: 3 }),
    });
  });

  it('sends the expected revision and ordered action without optimistic local state', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(session)));
    vi.stubGlobal('fetch', fetch);
    const command = {
      revision: 1,
      command: 'act' as const,
      action: { seq: 2, action: { type: 'swap' as const, left: 1, right: 2 } },
    };

    const updated = await sendGameCommand(session.id, command);

    expect(updated.revision).toBe(2);
    expect(fetch).toHaveBeenCalledWith(
      `/api/games/sessions/${session.id}`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(command),
      }),
    );
  });

  it('keeps server conflict messages actionable and rejects malformed successful payloads', async () => {
    const conflict = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'invalid_input', message: 'session revision is stale' } }),
          { status: 409 },
        ),
    );
    await expect(sendGameCommand(session.id, { revision: 1, command: 'pause' }, conflict)).rejects.toThrow(
      'session revision is stale',
    );

    const invalid = vi.fn(async () => new Response(JSON.stringify({ id: session.id }), { status: 200 }));
    await expect(loadGameSession(session.id, invalid)).rejects.toThrow('invalid session');
  });

  it('deletes only the requested server session and preserves server refusal details', async () => {
    const accepted = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(deleteGameSession(session.id, accepted)).resolves.toBeUndefined();
    expect(accepted).toHaveBeenCalledWith(`/api/games/sessions/${session.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });

    const denied = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'delete unavailable' } }), { status: 503 }),
    );
    await expect(deleteGameSession(session.id, denied)).rejects.toThrow('delete unavailable');
  });
});
