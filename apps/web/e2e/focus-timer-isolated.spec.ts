import { expect, test, type Page } from '@playwright/test';
import { FocusStartRequestSchema, type FocusSessionResponse } from '@studyvault/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const SESSION_ID = '77777777-7777-4777-8777-777777777777';
const activeTimer = (page: Page) => page.getByRole('region', { name: 'Active focus session' });
const pageControls = (page: Page) => page.getByRole('region', { name: 'Page focus controls' });

async function focusApi(
  page: Page,
  options: { failCompletion?: boolean; delayCompletion?: boolean; failRestore?: boolean } = {},
) {
  let active: FocusSessionResponse | null = null;
  let starts = 0;
  let restores = 0;
  let completions = 0;
  let failuresLeft = options.failCompletion ? 1 : 0;
  let restoreFailuresLeft = options.failRestore ? 1 : 0;
  let releaseCompletion: (() => void) | undefined;
  const completionGate = options.delayCompletion
    ? new Promise<void>((resolve) => {
        releaseCompletion = resolve;
      })
    : Promise.resolve();

  await page.route('**/api/focus-sessions**', async (route) => {
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
      if (restoreFailuresLeft > 0) {
        restoreFailuresLeft -= 1;
        await fulfill(
          { error: { code: 'internal', message: 'Focus session temporarily unavailable.' } },
          503,
        );
        return;
      }
      await fulfill(active);
      return;
    }
    if (path.endsWith('/complete')) {
      completions += 1;
      await completionGate;
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        await fulfill({ error: { code: 'internal', message: 'Session save temporarily unavailable.' } }, 503);
        return;
      }
      const session = active;
      if (!session) throw new Error('Unexpected duplicate focus completion');
      const browserNow = await page.evaluate(() => Date.now());
      const completed = browserNow >= new Date(session.expected_end_at).getTime();
      active = null;
      await fulfill({
        id: SESSION_ID,
        status: completed ? 'completed' : 'abandoned',
        actual_seconds: Math.floor((browserNow - new Date(session.started_at).getTime()) / 1000),
        tokens_awarded: completed ? 5 : 0,
        token_balance: completed ? 10 : 5,
        replayed: false,
      });
      return;
    }
    if (path === '/api/focus-sessions' && request.method() === 'POST') {
      starts += 1;
      const input = FocusStartRequestSchema.parse(request.postDataJSON());
      const plannedSeconds = { pomodoro: 1500, desk: 3000, ultradian: 5400 }[input.kind];
      const browserNow = await page.evaluate(() => Date.now());
      active = {
        id: SESSION_ID,
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
    releaseCompletion: () => releaseCompletion?.(),
  };
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test('keeps the same running countdown across Study, other pages, and a reload', async ({
  page,
}, testInfo) => {
  const api = await focusApi(page);
  await page.goto('/');
  await expect(activeTimer(page)).toHaveCount(0);
  await pageControls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(activeTimer(page).getByRole('timer')).toHaveText('25:00');
  await expect(pageControls(page).getByLabel('time remaining', { exact: true })).toHaveText('25:00');
  expect(api.starts).toBe(1);
  expect(api.restores).toBe(1);

  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study', exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 42_000));
  await expect(activeTimer(page).getByRole('timer')).toHaveText('24:18');
  expect(api.restores).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('focus-study-desktop.png'), fullPage: false });
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(activeTimer(page).getByRole('timer')).toHaveText('24:18');
  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await page.reload();
  await expect(activeTimer(page).getByRole('timer')).toHaveText('24:18');
  expect(api.restores).toBe(2);
  expect(api.starts).toBe(1);

  await page.getByRole('link', { name: 'Focus & progress', exact: true }).click();
  await expect(pageControls(page).getByLabel('time remaining', { exact: true })).toHaveText('24:18');
  expect(api.completions).toBe(0);
});

test('automatically completes exactly once while studying outside Progress', async ({ page }) => {
  const api = await focusApi(page);
  await page.goto('/?view=study');
  await pageControls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(activeTimer(page).getByRole('timer')).toHaveText('25:00');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 1_500_000));
  await expect(activeTimer(page)).toHaveCount(0);
  expect(api.completions).toBe(1);
  await page.getByRole('link', { name: 'Focus & progress', exact: true }).click();
  await expect(pageControls(page).getByText(/Session complete.*5 tokens/)).toBeVisible();
  await expect(pageControls(page).getByRole('button', { name: /Pomodoro/ })).toBeEnabled();
  expect(api.completions).toBe(1);
});

test('shares end-session state and blocks duplicate completion submissions', async ({ page }) => {
  const api = await focusApi(page, { delayCompletion: true });
  await page.goto('/');
  await pageControls(page).getByRole('button', { name: /Desk/ }).click();
  await expect(activeTimer(page).getByRole('timer')).toHaveText('50:00');
  await activeTimer(page).getByRole('button', { name: 'End session', exact: true }).click();
  await expect.poll(() => api.completions).toBe(1);
  await expect(pageControls(page).getByRole('button', { name: /End session|Saving/ })).toBeDisabled();
  api.releaseCompletion();
  await expect(activeTimer(page)).toHaveCount(0);
  await expect(pageControls(page).getByRole('button', { name: /Desk/ })).toBeEnabled();
  expect(api.completions).toBe(1);
});

test('retains the active timer after a save failure and allows retry from any page', async ({ page }) => {
  const api = await focusApi(page, { failCompletion: true });
  await page.goto('/');
  await pageControls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 1_500_000));
  await expect(activeTimer(page).getByRole('timer')).toHaveText('00:00');
  await expect(activeTimer(page).getByText(/Could not|unavailable|save/i)).toBeVisible();
  expect(api.completions).toBe(1);
  // A fresh tick must not automatically resubmit a failing completion.
  await page.clock.setFixedTime(new Date(NOW.getTime() + 1_510_000));
  await expect(activeTimer(page).getByRole('button', { name: /End session|Retry/ })).toBeEnabled();
  await activeTimer(page)
    .getByRole('button', { name: /End session|Retry/ })
    .click();
  await expect(activeTimer(page)).toHaveCount(0);
  expect(api.completions).toBe(2);
});

test('shows an accessible active timer on narrow Study pages without overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await focusApi(page);
  await page.goto('/?view=study');
  await expect(activeTimer(page)).toHaveCount(0);
  await pageControls(page)
    .getByRole('button', { name: /Ultradian/ })
    .click();
  await expect(activeTimer(page).getByRole('timer', { name: 'Focus time remaining' })).toHaveText('90:00');
  await page.screenshot({ path: testInfo.outputPath('focus-study-mobile.png'), fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect(activeTimer(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('focus-study-mobile-sticky.png'), fullPage: false });
});

test('recovers a failed session restore from any page before allowing a new session', async ({ page }) => {
  const api = await focusApi(page, { failRestore: true });
  await page.goto('/?view=overview');
  await expect(activeTimer(page).getByRole('status')).toContainText(/restore|unavailable/i);
  await expect(
    activeTimer(page).getByRole('button', { name: 'Retry focus session', exact: true }),
  ).toBeEnabled();
  expect(api.restores).toBe(1);

  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await expect(pageControls(page).getByRole('button', { name: /Pomodoro/ })).toBeDisabled();
  expect(api.starts).toBe(0);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await activeTimer(page).getByRole('button', { name: 'Retry focus session', exact: true }).click();
  await expect(activeTimer(page)).toHaveCount(0);
  expect(api.restores).toBe(2);

  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await expect(pageControls(page).getByRole('button', { name: /Pomodoro/ })).toBeEnabled();
  await pageControls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(activeTimer(page).getByRole('timer')).toHaveText('25:00');
  expect(api.starts).toBe(1);
  expect(api.completions).toBe(0);
});
