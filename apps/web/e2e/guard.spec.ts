import { expect, test } from '@playwright/test';

/**
 * Unauthenticated guard rails. These run with no Clerk session and no live
 * Clerk JS, so they work in CI with placeholder keys.
 *
 * Protection is server-side (`app/(protected)/layout.tsx` redirects before the
 * page renders), which is why these assertions hold even when Clerk's client
 * bundle never loads.
 */
test.beforeEach(async ({ page, baseURL }) => {
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k') return;
  if (!baseURL) throw new Error('Anonymous guard tests require a local baseURL.');

  // Clerk development instances handshake browser navigations before reporting
  // signed-out auth. The CI placeholder domain cannot serve that handshake.
  // Fetch the real middleware response as a non-document request instead; all
  // server auth checks and redirects still run, with no session or mocked auth.
  await page.route(`${new URL(baseURL).origin}/**`, async (route) => {
    if (!route.request().isNavigationRequest() || route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const response = await route.fetch({
      headers: { ...route.request().headers(), 'sec-fetch-dest': 'empty' },
      maxRedirects: 0,
    });
    await route.fulfill({ response });
  });
});

test('home page renders for anonymous visitors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Turn a PDF into/ })).toBeVisible();
});

test('sign-in entry points and OAuth landing routes stay on the app origin', async ({ page }) => {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/sign-in',
  );
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(origin + '/sign-up');
  await expect(page.getByRole('heading', { name: 'Build your study space.' })).toBeVisible();

  const callbackCases: ReadonlyArray<readonly [string, string]> = [
    ['/sign-in/sso-callback', 'Pick up where you left off.'],
    ['/sign-up/sso-callback', 'Build your study space.'],
  ];
  for (const [path, heading] of callbackCases) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).origin).toBe(origin);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
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
  for (const path of [
    '/progress',
    '/tools',
    '/document/abc',
    '/library',
    '/tutor',
    '/games',
    '/games/n-queens',
    '/games/cyberverse',
  ]) {
    await page.goto(path);
    await expect(page, `${path} should redirect`).toHaveURL(/\/sign-in/);
  }
});

test('Cyberverse export requires a same-origin frame request', async ({ request }) => {
  const asset = '/games/cyberverse/index.html';
  const direct = await request.get(asset, { maxRedirects: 0 });
  expect(direct.status()).toBe(307);
  expect(direct.headers().location).toBe('/games/cyberverse');

  const crossSite = await request.get(asset, {
    headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' },
    maxRedirects: 0,
  });
  expect(crossSite.status()).toBe(307);

  const embedded = await request.get(asset, {
    headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' },
    maxRedirects: 0,
  });
  expect(embedded.status()).toBe(200);
  expect(embedded.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
  expect(embedded.headers()['cache-control']).toContain('no-store');
});
