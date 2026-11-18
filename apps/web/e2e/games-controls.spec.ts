import { expect, test, type Page } from '@playwright/test';
import { validateCompletion, type GameAction } from '@studyvault/game-engine';

// Uses the standalone engine harness to verify the same mountGameVault that
// the signed-in Next /games page mounts, without bypassing Clerk protection.
const base = process.env.E2E_GAMES_URL;
test.skip(!base, 'E2E_GAMES_URL must point to the standalone game-engine preview');

async function verifyNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const button of await page.getByRole('button').all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}
async function keyboardActivate(page: Page, name: RegExp | string) {
  const control = page.getByRole('button', { name });
  await control.focus();
  await page.keyboard.press('Enter');
}
const queens = ['Row 1, column 2', 'Row 2, column 4', 'Row 3, column 1', 'Row 4, column 3'];
const hanoi: Array<[number, number]> = [];
function solve(n: number, from: number, to: number, spare: number): void {
  if (!n) return;
  solve(n - 1, from, spare, to);
  hanoi.push([from, to]);
  solve(n - 1, spare, to, from);
}
solve(4, 1, 3, 2);

async function mockVerifiedReward(page: Page) {
  await page.route('**/api/games/rewards', async (route) => {
    const body = route.request().postDataJSON() as { game_id: string; actions: GameAction[] };
    const replay = validateCompletion(body.game_id, body.actions);
    expect(replay.complete).toBe(true);
    await route.fulfill({
      json: { tokens_awarded: Math.min(5, Math.max(1, Math.floor(replay.score / 200))), idempotent: false },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockVerifiedReward(page);
  await page.goto(base!);
});

test('all four games finish with pointer controls and replay verified result', async ({ page }) => {
  for (const name of ['Tile 1: 4', 'Tile 2: 1', 'Tile 2: 4', 'Tile 4: 2'])
    await page.getByRole('button', { name }).click();
  await expect(page.getByText('Game complete.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'N-Queens', exact: true }).click();
  for (const name of queens) await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByText('Game complete.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Towers of Hanoi', exact: true }).click();
  for (const [from, to] of hanoi) {
    await page.getByRole('button', { name: new RegExp(`^Tower ${from},`) }).click();
    await page.getByRole('button', { name: new RegExp(`^Tower ${to},`) }).click();
  }
  await expect(page.getByText('Game complete.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Flashcard Tower Defense', exact: true }).click();
  for (const answer of [true, false, true, false, true]) {
    const control = page.getByRole('button', { name: answer ? 'True (Y)' : 'False (N)' });
    await expect(control).toBeEnabled({ timeout: 5000 });
    await control.click();
  }
  await expect(page.getByText('Game complete.', { exact: false })).toBeVisible();
});

test('all games support keyboard-only activation, pause/reset and resize', async ({ page }) => {
  for (const name of ['Tile 1: 4', 'Tile 2: 1', 'Tile 2: 4', 'Tile 4: 2']) await keyboardActivate(page, name);
  await expect(page.getByText('Game complete.', { exact: false })).toBeVisible();
  await keyboardActivate(page, 'N-Queens');
  for (const name of queens) await keyboardActivate(page, new RegExp(`^${name}$`));
  await expect(page.getByText('Game complete.', { exact: false })).toBeVisible();
  await keyboardActivate(page, 'Towers of Hanoi');
  for (const [from, to] of hanoi) {
    await keyboardActivate(page, new RegExp(`^Tower ${from},`));
    await keyboardActivate(page, new RegExp(`^Tower ${to},`));
  }
  await expect(page.getByText('Game complete.', { exact: false })).toBeVisible();
  await keyboardActivate(page, 'Flashcard Tower Defense');
  for (const answer of [true, false, true, false, true]) {
    const control = page.getByRole('button', { name: answer ? 'True (Y)' : 'False (N)' });
    await expect(control).toBeEnabled({ timeout: 5000 });
    await control.focus();
    await page.keyboard.press(answer ? 'y' : 'n');
  }
  await expect(page.getByText('Game complete.', { exact: false })).toBeVisible();
  await keyboardActivate(page, 'Reset game');
  await keyboardActivate(page, 'Pause');
  await expect(page.getByText('Paused.', { exact: false })).toBeVisible();
  await page.waitForTimeout(2200);
  await expect(page.getByRole('button', { name: 'True (Y)' })).toBeDisabled();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await verifyNoOverflow(page);
  }
  await keyboardActivate(page, 'Resume');
  await expect(page.getByRole('button', { name: 'True (Y)' })).toBeEnabled({ timeout: 5000 });
  await keyboardActivate(page, 'Reset game');
  await expect(page.getByRole('button', { name: 'True (Y)' })).toBeDisabled();
});

test('touch can select games and operate all board controls without clipping', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await mockVerifiedReward(page);
  await page.goto(base!);
  for (const name of ['Tile 1: 4', 'Tile 2: 1', 'Tile 2: 4', 'Tile 4: 2'])
    await page.getByRole('button', { name }).tap();
  await page.getByRole('button', { name: 'N-Queens', exact: true }).tap();
  for (const name of queens) await page.getByRole('button', { name, exact: true }).tap();
  await expect(page.getByText('Game complete.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Towers of Hanoi', exact: true }).tap();
  for (const [from, to] of hanoi) {
    await page.getByRole('button', { name: new RegExp(`^Tower ${from},`) }).tap();
    await page.getByRole('button', { name: new RegExp(`^Tower ${to},`) }).tap();
  }
  await page.getByRole('button', { name: 'Flashcard Tower Defense', exact: true }).tap();
  for (const answer of [true, false, true, false, true]) {
    const control = page.getByRole('button', { name: answer ? 'True (Y)' : 'False (N)' });
    await expect(control).toBeEnabled({ timeout: 5000 });
    await control.tap();
  }
  await expect(page.getByText('Game complete.', { exact: false })).toBeVisible();
  await verifyNoOverflow(page);
  await context.close();
});
