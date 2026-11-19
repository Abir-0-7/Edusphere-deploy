import { clerk } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';

const testUserEmail = process.env.E2E_CLERK_USER_EMAIL;
const canRun = Boolean(testUserEmail && process.env.CLERK_SECRET_KEY);

test.skip(!canRun, 'Set E2E_CLERK_USER_EMAIL and CLERK_SECRET_KEY for authenticated Game Vault coverage');

test('a keyboard player can pause, refresh, resume and abandon a saved game on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await clerk.signIn({ page, emailAddress: testUserEmail! });
  await page.goto('/games');

  await expect(page.getByRole('heading', { name: 'Game Vault', level: 1, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Play now N-Queens', exact: true }).click();
  await expect(page).toHaveURL(/\/games\/n-queens$/);
  await page.getByRole('button', { name: 'New N-Queens' }).click();
  const player = page.getByRole('region', { name: 'Current session' });
  await expect(player).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  const square = page.getByRole('button', { name: 'Row 1, column 2', exact: true });
  await square.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[aria-label="Session score"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Row 1, column 2, queen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('paused', { exact: true })).toBeVisible();
  await page.reload();
  const savedResume = page
    .getByRole('region', { name: 'Saved sessions' })
    .getByRole('button', { name: 'Resume', exact: true })
    .first();
  await expect(savedResume).toBeVisible();
  await savedResume.click();
  await expect(player).toBeVisible();
  await player.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Row 1, column 2, queen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Abandon', exact: true }).click();
  await expect(page.getByText('abandoned', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);
});

test('all fourteen game definitions are available in the catalog', async ({ page }) => {
  await page.goto('/');
  await clerk.signIn({ page, emailAddress: testUserEmail! });
  await page.goto('/games');
  for (const name of [
    'Sorting Race',
    'N-Queens',
    'Towers of Hanoi',
    'Recall Defense',
    'Concept Match',
    'Retrieval Sprint',
    'Code Trace',
    'Debugging Detective',
    'SQL Detective',
    'Graph Path',
    'Proof Builder',
    'Data Detective',
    'Adaptive Quiz',
    'Exam Escape',
  ]) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: `Play now ${name}`, exact: true })).toBeVisible();
  }
});

test('an unknown game URL has no player', async ({ page }) => {
  await page.goto('/');
  await clerk.signIn({ page, emailAddress: testUserEmail! });
  await page.goto('/games/unknown-game');
  await expect(page.getByText('This page could not be found.')).toBeVisible();
});
