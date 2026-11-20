import { expect, test } from '@playwright/test';

test('Coast landing page fits supported widths', async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Turn a PDF into/ })).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'A source document, cited answer, and recall card' }),
    ).toBeVisible();
    await expect(page.locator('.coast-answer-card')).toBeVisible();
    expect(
      await page
        .locator('.welcome-intro')
        .evaluate((element) => [
          getComputedStyle(element, '::before').content,
          getComputedStyle(element, '::after').content,
        ]),
    ).toEqual(['none', 'none']);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      'landing page should not overflow at ' + width + 'px',
    ).toBeLessThanOrEqual(1);
  }
});

test('Coast public policy pages fit phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pages: readonly (readonly [string, RegExp])[] = [
    ['/privacy', /Privacy/],
    ['/terms', /Terms of use/],
  ];
  for (const [path, heading] of pages) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      path + ' should not overflow at 390px',
    ).toBeLessThanOrEqual(1);
  }
});
