import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const api = 'http://127.0.0.1:4336';
const headers = (owner: string) => ({ Authorization: `Bearer generation-fixture-${owner}` });
async function start(page: Page) {
  await page.getByRole('button', { name: 'Preview generation budget', exact: true }).click();
  const budget = page.getByRole('region', { name: 'Generation budget preview' });
  await expect(budget).toContainText('2 lesson stages');
  await expect(
    page.getByRole('button', { name: 'Start private lesson generation', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('I accept this generation budget and understand the drafts need review.').check();
  await page.getByRole('button', { name: 'Start private lesson generation', exact: true }).click();
}
async function mode(request: APIRequestContext, owner: string, value: string) {
  const response = await request.post(`${api}/api/fixture/provider-mode`, {
    headers: headers(owner),
    data: { mode: value },
  });
  expect(response.ok()).toBe(true);
}

test('provider outage retains stage one and budget; explicit resume completes private drafts after reload', async ({
  page,
  request,
}) => {
  const owner = 'outage-owner';
  await page.addInitScript((account) => localStorage.setItem('generation-fixture-account', account), owner);
  await mode(request, owner, 'outage_once');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Preview generation budget', exact: true })).toBeEnabled();
  await start(page);
  const progress = page.getByRole('region', { name: 'Saved generation progress' });
  await expect(progress).toContainText('Generation failed: 1/2 stages saved', { timeout: 20_000 });
  await expect(progress).toContainText('attempts 1/2');
  const failedText = await progress.getByText('Allocated token upper bound:', { exact: false }).textContent();
  await page.getByText('Review saved lesson 1', { exact: true }).click();
  await expect(progress).toContainText('Energy is conserved in an isolated system.');
  await page.reload();
  await page.getByLabel('Saved lesson generation').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Open saved lesson drafts', exact: true }).click();
  await expect(progress).toContainText('Generation failed: 1/2 stages saved');
  await expect(progress).toContainText(failedText ?? 'missing budget');
  await expect(page.getByRole('button', { name: 'Resume saved generation', exact: true })).toBeDisabled();
  await page.getByLabel('I accept the remaining budget and want to resume this run.').check();
  await page.getByRole('button', { name: 'Resume saved generation', exact: true }).click();
  await expect(progress).toContainText('Generation done: 2/2 stages saved', { timeout: 20_000 });
  const state = await (
    await request.get(`${api}/api/fixture/provider-state`, { headers: headers(owner) })
  ).json();
  expect(state.calls).toEqual(['energy', 'momentum', 'momentum']);
  await expect(page.getByLabel('Saved lesson generation').locator('option:checked')).toContainText(
    '2/2 stages, done',
  );
  await expect(progress).toContainText('Private · Editorial: not reviewed');
  await expect(progress.getByRole('button', { name: /publish|catalog/i })).toHaveCount(0);
  await progress.getByText('Review saved lesson 1', { exact: true }).click();
  await progress.locator('li').first().getByText('Exact source version and hash', { exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);
  await progress
    .locator('li')
    .first()
    .screenshot({ path: '.tmp-playwright/f04/course-generation-lesson-390.png' });
  await progress.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.tmp-playwright/f04/course-generation-done-390.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '.tmp-playwright/f04/course-generation-done-1440.png' });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);
  await page.getByLabel('Acceptance account').selectOption('other');
  await expect(page.getByText('No saved lesson drafts yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved generation progress' })).toHaveCount(0);
});

test('cancellation during a stage retains completed output and resumes its successful operation once', async ({
  page,
  request,
}) => {
  const owner = 'cancel-owner';
  await page.addInitScript((account) => localStorage.setItem('generation-fixture-account', account), owner);
  await mode(request, owner, 'hold');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Preview generation budget', exact: true })).toBeEnabled();
  await start(page);
  await expect
    .poll(
      async () =>
        (await (await request.get(`${api}/api/fixture/provider-state`, { headers: headers(owner) })).json())
          .calls,
    )
    .toEqual(['energy', 'momentum']);
  await page.getByRole('button', { name: 'Refresh saved progress', exact: true }).click();
  const progress = page.getByRole('region', { name: 'Saved generation progress' });
  await expect(progress).toContainText('1/2 stages saved');
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  await expect(progress).toContainText('Generation cancelled: 1/2 stages saved');
  await mode(request, owner, 'release');
  await page.getByLabel('I accept the remaining budget and want to resume this run.').check();
  await page.getByRole('button', { name: 'Resume saved generation', exact: true }).click();
  await expect(progress).toContainText('Generation done: 2/2 stages saved', { timeout: 20_000 });
  const state = await (
    await request.get(`${api}/api/fixture/provider-state`, { headers: headers(owner) })
  ).json();
  expect(state.calls).toEqual(['energy', 'momentum']);
});

test('disabled generation and temporary errors provide quiet availability or retry', async ({ page }) => {
  let disabled = true;
  await page.route(/\/api\/course-generations(?:\?|$)/, async (route) => {
    if (disabled)
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'not_found', message: 'Disabled' } }),
      });
    else await route.continue();
  });
  await page.goto('/');
  await expect(
    page.getByText('Private lesson generation is not available in this environment yet.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview generation budget', exact: true })).toHaveCount(0);
  disabled = false;
  await page.unroute(/\/api\/course-generations(?:\?|$)/);
  let unavailable = true;
  await page.route(/\/api\/course-generations(?:\?|$)/, async (route) => {
    if (unavailable)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'internal', message: 'Generation storage is temporarily unavailable.' },
        }),
      });
    else await route.continue();
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Generation storage is temporarily unavailable.');
  unavailable = false;
  await page.getByRole('button', { name: 'Retry loading lesson drafts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview generation budget', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a stale cancel shows a conflict without discarding saved lesson progress', async ({
  page,
  request,
}) => {
  const owner = 'stale-generation-owner';
  await page.addInitScript((account) => localStorage.setItem('generation-fixture-account', account), owner);
  await mode(request, owner, 'hold');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Preview generation budget', exact: true })).toBeEnabled();
  await start(page);
  await expect
    .poll(
      async () =>
        (await (await request.get(`${api}/api/fixture/provider-state`, { headers: headers(owner) })).json())
          .calls,
    )
    .toEqual(['energy', 'momentum']);
  await page.getByRole('button', { name: 'Refresh saved progress', exact: true }).click();
  const list = await (await request.get(`${api}/api/course-generations`, { headers: headers(owner) })).json();
  const run = await (
    await request.get(`${api}/api/course-generations/${list.items[0].id}`, { headers: headers(owner) })
  ).json();
  expect(
    (
      await request.post(`${api}/api/course-generations/${run.id}/cancel`, {
        headers: headers(owner),
        data: { expected_revision: run.revision },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Refresh saved progress before trying again; completed drafts are still retained.',
  );
  await expect(page.getByRole('region', { name: 'Saved generation progress' })).toContainText(
    '1/2 stages saved',
  );
  await page.getByRole('button', { name: 'Refresh saved progress', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved generation progress' })).toContainText(
    'Generation cancelled: 1/2 stages saved',
  );
  await mode(request, owner, 'release');
});
