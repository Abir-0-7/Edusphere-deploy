import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('preview, apply, switch back, and keep completed course evidence at 390px', async ({
  page,
  browser,
}) => {
  const user = randomUUID();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.addInitScript((id) => localStorage.setItem('track-fixture-user', id), user);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Learning track' })).toBeVisible();
  await expect(page.getByText(/Current track: Data analyst foundations/)).toBeVisible();
  await page.getByLabel('Track to preview').selectOption('developer');
  await page.getByRole('button', { name: 'Preview track change' }).click();
  await expect(page.getByRole('heading', { name: 'Proposed plan revision 1' })).toBeVisible();
  const preview = page.getByRole('region', { name: 'Proposed plan revision 1' });
  await expect(preview).toContainText('Add PyTorch Fundamentals');
  await expect(preview).toContainText('Trace values and expressions');
  await expect(preview).toContainText('completed work kept');
  await expect(preview).toContainText('plan only');
  await preview.getByRole('button', { name: 'Apply this plan revision' }).click();
  await expect(page.getByRole('status')).toContainText('Plan revision 1 saved');
  await page.getByRole('button', { name: 'View plan history' }).click();
  await expect(page.getByRole('region', { name: 'Past plan revisions' })).toContainText('Revision 1');

  await page.getByLabel('Track to preview').selectOption('programming-exam');
  await page.getByRole('button', { name: 'Preview track change' }).click();
  const returnPreview = page.getByRole('region', { name: 'Proposed plan revision 2' });
  await expect(returnPreview).toContainText('Remove PyTorch Fundamentals');
  await expect(returnPreview).toContainText('completed work kept');
  await returnPreview.getByRole('button', { name: 'Apply this plan revision' }).click();
  await expect(page.getByRole('status')).toContainText('Plan revision 2 saved');
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);

  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await secondContext.addInitScript((id) => localStorage.setItem('track-fixture-user', id), user);
    const returning = await secondContext.newPage();
    await returning.goto('/');
    await expect(returning.getByText(/Current track: Programming exam foundations/)).toBeVisible();
    await returning.getByRole('button', { name: 'View plan history' }).click();
    const history = returning.getByRole('region', { name: 'Past plan revisions' });
    await expect(history).toContainText('Revision 2');
    await expect(history).toContainText('Revision 1');
  } finally {
    await secondContext.close();
  }
  expect(browserErrors).toEqual([]);
});
