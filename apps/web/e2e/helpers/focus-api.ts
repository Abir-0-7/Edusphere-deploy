import type { BrowserContext, Page } from '@playwright/test';
import {
  FocusStartRequestSchema,
  type FocusCompletionResponse,
  type FocusSessionResponse,
} from '@studyvault/types';

const SESSION_ID = '77777777-7777-4777-8777-777777777777';

function delayedResponse(page: Page) {
  let release = () => {};
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { page, response, release: () => release(), waiting: false, delivered: false };
}

/** Shared server state lets separate browser pages observe one focus session. */
export async function focusApi(
  target: Page | BrowserContext,
  options: { failCompletion?: boolean; failRestore?: boolean; delayRestore?: boolean } = {},
) {
  let active: FocusSessionResponse | null = null;
  let starts = 0;
  let restores = 0;
  let completions = 0;
  let nextRestore: ReturnType<typeof delayedResponse> | undefined;
  let nextCompletion: ReturnType<typeof delayedResponse> | undefined;
  const completedSessions = new Map<string, FocusCompletionResponse>();
  let failuresLeft = options.failCompletion ? 1 : 0;
  let restoreFailuresLeft = options.failRestore ? 1 : 0;
  let releaseRestore: (() => void) | undefined;
  const restoreGate = options.delayRestore
    ? new Promise<void>((resolve) => {
        releaseRestore = resolve;
      })
    : Promise.resolve();

  await target.route('**/api/focus-sessions**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const fulfill = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    if (path.endsWith('/current')) {
      restores += 1;
      const current = active;
      const delayed = nextRestore?.page === request.frame().page() ? nextRestore : undefined;
      if (delayed) {
        nextRestore = undefined;
        delayed.waiting = true;
        await delayed.response;
      }
      await restoreGate;
      if (restoreFailuresLeft > 0) {
        restoreFailuresLeft -= 1;
        await fulfill(
          { error: { code: 'internal', message: 'Focus session temporarily unavailable.' } },
          503,
        );
        return;
      }
      await fulfill(current);
      if (delayed) delayed.delivered = true;
      return;
    }
    if (path.endsWith('/complete')) {
      completions += 1;
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        await fulfill({ error: { code: 'internal', message: 'Session save temporarily unavailable.' } }, 503);
        return;
      }
      const id = path.split('/').at(-2) ?? '';
      const saved = completedSessions.get(id);
      if (saved) {
        await fulfill({ ...saved, replayed: true });
        return;
      }
      const session = active;
      if (!session || session.id !== id) throw new Error('Unexpected focus completion');
      const browserNow = await request
        .frame()
        .page()
        .evaluate(() => Date.now());
      const completed = browserNow >= new Date(session.expected_end_at).getTime();
      active = null;
      const result: FocusCompletionResponse = {
        id: session.id,
        status: completed ? 'completed' : 'abandoned',
        actual_seconds: Math.floor((browserNow - new Date(session.started_at).getTime()) / 1000),
        tokens_awarded: completed ? 5 : 0,
        token_balance: completed ? 10 : 5,
        replayed: false,
      };
      completedSessions.set(session.id, result);
      const delayed = nextCompletion?.page === request.frame().page() ? nextCompletion : undefined;
      if (delayed) {
        nextCompletion = undefined;
        delayed.waiting = true;
        await delayed.response;
      }
      await fulfill(result);
      if (delayed) delayed.delivered = true;
      return;
    }
    if (path === '/api/focus-sessions' && request.method() === 'POST') {
      starts += 1;
      const input = FocusStartRequestSchema.parse(request.postDataJSON());
      if (active) {
        await fulfill(
          { error: { code: 'invalid_input', message: 'A focus session is already running.' } },
          409,
        );
        return;
      }
      const plannedSeconds = { pomodoro: 1500, desk: 3000, ultradian: 5400 }[input.kind];
      const browserNow = await request
        .frame()
        .page()
        .evaluate(() => Date.now());
      active = {
        id: starts === 1 ? SESSION_ID : `77777777-7777-4777-8777-${String(starts).padStart(12, '0')}`,
        kind: input.kind,
        planned_seconds: plannedSeconds,
        actual_seconds: 0,
        status: 'running',
        started_at: new Date(browserNow).toISOString(),
        expected_end_at: new Date(browserNow + plannedSeconds * 1000).toISOString(),
        ended_at: null,
      };
      await fulfill(active, 201);
      return;
    }
    throw new Error(`Unexpected focus fixture request: ${request.method()} ${path}`);
  });
  return {
    get starts() {
      return starts;
    },
    get restores() {
      return restores;
    },
    get completions() {
      return completions;
    },
    releaseRestore: () => releaseRestore?.(),
    holdNextRestore: (page: Page) => {
      nextRestore = delayedResponse(page);
      return nextRestore;
    },
    holdNextCompletion: (page: Page) => {
      nextCompletion = delayedResponse(page);
      return nextCompletion;
    },
  };
}
