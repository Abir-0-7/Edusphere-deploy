import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { GameIdSchema } from '@studyvault/types';
import { focusApi } from './helpers/focus-api';

const NOW = new Date('2026-11-20T12:00:00Z');
const lock = (page: Page) => page.getByRole('heading', { name: 'Game Vault is locked', exact: true });
const activeTimer = (page: Page) => page.getByRole('region', { name: 'Active focus session' });
const controls = (page: Page) => page.getByRole('region', { name: 'Fixture focus controls' });
const newGame = (page: Page) => page.getByRole('button', { name: 'New Sorting Race', exact: true });

/** Only reads are needed: the tests verify players are never mounted while locked. */
async function gameReads(target: Page | BrowserContext) {
  let requests = 0;
  await target.route('**/api/tokens/balance', (route) => route.fulfill({ json: { balance: 5 } }));
  await target.route('**/api/games/sessions', async (route) => {
    requests += 1;
    await route.fulfill({
      json: {
        sessions: [],
        progression: Object.fromEntries(GameIdSchema.options.map((id) => [id, 0])),
      },
    });
  });
  await target.route('**/api/game-vault/context?*', async (route) => {
    requests += 1;
    await route.fulfill({
      json: {
        ok: true,
        state: {
          mode: 'production',
          student: { id: 'fixture-learner', displayName: 'Learner' },
          tokens: 5,
          xp: 0,
          unlocked: [],
          completed: [],
          achievements: [],
        },
      },
    });
  });
  await target.route('**/games/cyberverse/index.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body>Cyberverse fixture</body></html>',
    }),
  );
  return {
    get requests() {
      return requests;
    },
  };
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test('withholds direct game access until the focus session restore finishes', async ({ page }) => {
  const api = await focusApi(page, { delayRestore: true });
  const games = await gameReads(page);
  await page.goto('/games/sorting-race');
  await expect.poll(() => api.restores).toBe(1);
  await expect(newGame(page)).toHaveCount(0);
  expect(games.requests).toBe(0);
  api.releaseRestore();
  await expect(newGame(page)).toBeEnabled();
  expect(games.requests).toBe(1);
});

test('locks a mounted player immediately, survives reload, and unlocks after ending focus', async ({
  page,
}, testInfo) => {
  const api = await focusApi(page);
  const games = await gameReads(page);
  await page.goto('/games/sorting-race');
  await expect(newGame(page)).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Game vault', exact: true })).toHaveAttribute('href', '/games');
  await controls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(lock(page)).toBeVisible();
  await expect(newGame(page)).toHaveCount(0);
  await expect(page.getByText('Games locked', { exact: true })).toBeVisible();
  const disabledVaultLink = page.getByRole('link', { name: /^Game vault\s*Locked$/ });
  await expect(disabledVaultLink).toHaveAttribute('aria-disabled', 'true');
  await expect(disabledVaultLink).not.toHaveAttribute('href');
  await expect(page.locator('summary', { hasText: 'Games' })).toHaveCount(0);
  await expect(activeTimer(page).getByRole('timer')).toHaveText('25:00');
  await page.screenshot({
    path: testInfo.outputPath('focus-game-vault-locked-desktop.png'),
    fullPage: false,
  });

  await page.reload();
  await expect(lock(page)).toBeVisible();
  await expect(activeTimer(page).getByRole('timer')).toHaveText('25:00');
  await expect(newGame(page)).toHaveCount(0);
  expect(games.requests).toBe(1);
  expect(api.starts).toBe(1);
  await activeTimer(page).getByRole('button', { name: 'End session', exact: true }).click();
  await expect(lock(page)).toHaveCount(0);
  await expect(newGame(page)).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Game vault', exact: true })).toHaveAttribute('href', '/games');
  await expect(page.locator('summary', { hasText: 'Games' })).toBeVisible();
  expect(api.completions).toBe(1);
});

test('blocks the vault, puzzle deep links, and embedded Cyberverse on a narrow viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await focusApi(page);
  const games = await gameReads(page);
  await page.goto('/games');
  await expect(page.getByRole('link', { name: 'Play now Sorting Race', exact: true })).toBeVisible();
  await controls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(lock(page)).toBeVisible();
  for (const path of ['/games', '/games/sorting-race', '/games/cyberverse']) {
    await page.goto(path);
    await expect(lock(page)).toBeVisible();
    await expect(
      page.getByText('Game Vault will unlock when your focus session ends.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /^Play now / })).toHaveCount(0);
    await expect(newGame(page)).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
  }
  expect(games.requests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('focus-game-vault-locked-mobile.png'), fullPage: false });
  await activeTimer(page).getByRole('button', { name: 'End session', exact: true }).click();
  await expect(lock(page)).toHaveCount(0);
  await expect(page.locator('iframe[title="Cyberverse interactive game"]')).toBeVisible();
  expect(games.requests).toBe(1);
});

test('keeps players locked after a restoration failure until a successful retry', async ({ page }) => {
  const api = await focusApi(page, { failRestore: true });
  const games = await gameReads(page);
  await page.goto('/games/sorting-race');
  await expect(
    activeTimer(page).getByRole('button', { name: 'Retry focus session', exact: true }),
  ).toBeEnabled();
  await expect(newGame(page)).toHaveCount(0);
  expect(games.requests).toBe(0);
  await activeTimer(page).getByRole('button', { name: 'Retry focus session', exact: true }).click();
  await expect(newGame(page)).toBeEnabled();
  expect(api.restores).toBe(2);
});

test('keeps the vault locked after failed completion and unlocks on a successful retry', async ({ page }) => {
  const api = await focusApi(page, { failCompletion: true });
  const games = await gameReads(page);
  await page.goto('/games/sorting-race');
  await expect(newGame(page)).toBeEnabled();
  await controls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(lock(page)).toBeVisible();
  await activeTimer(page).getByRole('button', { name: 'End session', exact: true }).click();
  await expect(activeTimer(page).getByRole('status')).toContainText(/Could not save/);
  await expect(lock(page)).toBeVisible();
  await expect(newGame(page)).toHaveCount(0);
  expect(games.requests).toBe(1);
  await activeTimer(page).getByRole('button', { name: 'End session', exact: true }).click();
  await expect(newGame(page)).toBeEnabled();
  await expect(lock(page)).toHaveCount(0);
  expect(api.completions).toBe(2);
});

test('automatically unlocks games when the focus timer completes', async ({ page }) => {
  const api = await focusApi(page);
  await gameReads(page);
  await page.goto('/games/sorting-race');
  await expect(newGame(page)).toBeEnabled();
  await controls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(lock(page)).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 1_500_000));
  await expect(lock(page)).toHaveCount(0);
  await expect(newGame(page)).toBeEnabled();
  expect(api.completions).toBe(1);
});

test('locks an already open game tab when focus starts in another tab and unlocks it when focus ends', async ({
  page,
  context,
}) => {
  const api = await focusApi(context);
  await gameReads(context);
  const gameTab = await context.newPage();
  await gameTab.clock.setFixedTime(NOW);
  await page.goto('/games');
  await gameTab.goto('/games/sorting-race');
  await expect(newGame(gameTab)).toBeEnabled();
  await page.bringToFront();
  await controls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(lock(page)).toBeVisible();
  await expect(lock(gameTab)).toBeVisible();
  await expect(newGame(gameTab)).toHaveCount(0);
  await activeTimer(page).getByRole('button', { name: 'End session', exact: true }).click();
  await expect(lock(gameTab)).toHaveCount(0);
  await expect(newGame(gameTab)).toBeEnabled();
  expect(api.starts).toBe(1);
  expect(api.completions).toBe(1);
  await gameTab.close();
});

test('ignores an older restore response arriving after the same tab ends focus', async ({
  page,
  context,
}) => {
  const api = await focusApi(context);
  await gameReads(context);
  const otherTab = await context.newPage();
  await otherTab.clock.setFixedTime(NOW);
  await page.goto('/games/sorting-race');
  await otherTab.goto('/games');
  await expect(newGame(page)).toBeEnabled();
  await controls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(activeTimer(otherTab).getByRole('timer')).toHaveText('25:00');

  const delayedRestore = api.holdNextRestore(page);
  // A real account notification starts a restore whose response retains X.
  await otherTab.evaluate(() => {
    const changed = new BroadcastChannel('studyvault:focus:fixture-learner');
    changed.postMessage('changed');
    changed.close();
  });
  await expect.poll(() => delayedRestore.waiting).toBe(true);
  await activeTimer(page).getByRole('button', { name: 'End session', exact: true }).click();
  await expect(activeTimer(page)).toHaveCount(0);
  await expect(newGame(page)).toBeEnabled();

  const staleResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/focus-sessions/current'),
  );
  delayedRestore.release();
  await (await staleResponse).finished();
  await expect.poll(() => delayedRestore.delivered).toBe(true);
  // Give React a rendered frame after the stale response has reached the page.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(activeTimer(page)).toHaveCount(0);
  await expect(lock(page)).toHaveCount(0);
  await expect(newGame(page)).toBeEnabled();
  expect(api.completions).toBe(1);
  await otherTab.close();
});

test('rechecks changes received while completion is pending so a newer focus session stays locked', async ({
  page,
  context,
}) => {
  const api = await focusApi(context);
  await gameReads(context);
  const otherTab = await context.newPage();
  await otherTab.clock.setFixedTime(NOW);
  await page.goto('/games/sorting-race');
  await otherTab.goto('/games');
  await expect(newGame(page)).toBeEnabled();
  await controls(page)
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(activeTimer(otherTab).getByRole('timer')).toHaveText('25:00');

  const delayedCompletion = api.holdNextCompletion(page);
  await activeTimer(page).getByRole('button', { name: 'End session', exact: true }).click();
  await expect.poll(() => delayedCompletion.waiting).toBe(true);
  // The server has ended X, but this tab has not received that completion yet.
  // The other tab replays X's idempotent completion, then starts distinct Y.
  await activeTimer(otherTab).getByRole('button', { name: 'End session', exact: true }).click();
  await expect(activeTimer(otherTab)).toHaveCount(0);
  await controls(otherTab).getByRole('button', { name: /Desk/ }).click();
  await expect(activeTimer(otherTab).getByRole('timer')).toHaveText('50:00');
  delayedCompletion.release();

  await expect(activeTimer(page).getByRole('timer')).toHaveText('50:00');
  await expect(lock(page)).toBeVisible();
  await expect(newGame(page)).toHaveCount(0);
  expect(api.starts).toBe(2);
  expect(api.completions).toBe(2);
  await otherTab.close();
});
