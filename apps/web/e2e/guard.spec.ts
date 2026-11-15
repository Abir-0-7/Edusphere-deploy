import { expect, test } from '@playwright/test';

/**
 * Unauthenticated guard rails. These run with no Clerk session and no live
 * Clerk JS, so they work in CI with placeholder keys.
 *
 * Protection is server-side (`app/(protected)/layout.tsx` redirects before the
 * page renders), which is why these assertions hold even when Clerk's client
 * bundle never loads.
 */
test('home page renders for anonymous visitors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'StudyVault' })).toBeVisible();
});

test('page scripts receive a nonce authorized by the response CSP', async ({ page }) => {
  const response = await page.goto('/');
  const csp = response?.headers()['content-security-policy'] ?? '';

  expect(csp).toContain("'strict-dynamic'");
  const script = page.locator('script[nonce]').first();
  await expect(script).toBeAttached();
  const nonce = await script.evaluate((element) => (element as HTMLScriptElement).nonce);
  expect(nonce).not.toBe('');
  expect(csp).toContain(`'nonce-${nonce}'`);
});

test('protected dashboard redirects to sign-in', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('review page is protected', async ({ page }) => {
  await page.goto('/review');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('every signed-in route redirects when unauthenticated', async ({ page }) => {
  for (const path of ['/progress', '/tools', '/document/abc']) {
    await page.goto(path);
    await expect(page, `${path} should redirect`).toHaveURL(/\/sign-in/);
  }
});
