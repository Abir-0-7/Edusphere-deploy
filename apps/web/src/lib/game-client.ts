import {
  GameCreateInputSchema,
  GameSessionListSchema,
  GameSessionSchema,
  type GameCreateInput,
  type GameSession,
  type GameSessionList,
  type GameCommandInput,
} from '@studyvault/types';

const SESSIONS = '/api/games/sessions';

async function readJson<T>(response: Response, parse: (value: unknown) => T): Promise<T> {
  if (!response.ok) {
    let message = `Game service returned ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const error = body.error;
        if (
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof error.message === 'string'
        ) {
          message = error.message;
        }
      }
    } catch {
      // Keep the status-derived message when the server did not return JSON.
    }
    throw new Error(message);
  }
  return parse(await response.json());
}

function parseSession(value: unknown): GameSession {
  const result = GameSessionSchema.safeParse(value);
  if (!result.success) throw new Error('Game service returned an invalid session.');
  return result.data;
}

function parseSessionList(value: unknown): GameSessionList {
  const result = GameSessionListSchema.safeParse(value);
  if (!result.success) throw new Error('Game service returned an invalid session list.');
  return result.data;
}

export async function listGameSessions(fetcher: typeof fetch = fetch): Promise<GameSessionList> {
  const response = await fetcher(SESSIONS, { credentials: 'same-origin' });
  return readJson(response, parseSessionList);
}

export async function loadGameSession(id: string, fetcher: typeof fetch = fetch): Promise<GameSession> {
  const response = await fetcher(`${SESSIONS}/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  return readJson(response, parseSession);
}

export async function deleteGameSession(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${SESSIONS}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (response.ok) return;
  let message = `Game service returned ${response.status}`;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const error = body.error;
      if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
      ) {
        message = error.message;
      }
    }
  } catch {
    // Keep the HTTP status message when the server returned no JSON.
  }
  throw new Error(message);
}

export async function createGameSession(
  input: GameCreateInput,
  fetcher: typeof fetch = fetch,
): Promise<GameSession> {
  const parsed = GameCreateInputSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid game selection.');
  const response = await fetcher(SESSIONS, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });
  return readJson(response, parseSession);
}

export async function sendGameCommand(
  id: string,
  input: GameCommandInput,
  fetcher: typeof fetch = fetch,
): Promise<GameSession> {
  const response = await fetcher(`${SESSIONS}/${encodeURIComponent(id)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson(response, parseSession);
}
