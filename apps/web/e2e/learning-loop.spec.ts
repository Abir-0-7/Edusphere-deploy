import { clerk } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';

/** Core learning loop (task 2.13): upload -> chapters -> chat -> review. */
const testUserEmail = process.env.E2E_CLERK_USER_EMAIL;
const canRun = Boolean(testUserEmail && process.env.CLERK_SECRET_KEY);

test.skip(!canRun, 'Set E2E_CLERK_USER_EMAIL and CLERK_SECRET_KEY for the authenticated loop');

test('upload -> chapters -> chat -> review', async ({ page }) => {
  await page.goto('/');
  await clerk.signIn({ page, emailAddress: testUserEmail! });

  await page.goto('/document/new');
  await page.setInputFiles('#pdf-upload', 'e2e/fixtures/lecture.pdf');
  await expect(page.getByRole('status')).toContainText(/pending|running|done|failed/, { timeout: 30_000 });
  await expect(page.getByRole('status')).toHaveText('done', { timeout: 120_000 });

  const chapters = page.locator('section', { has: page.getByRole('heading', { name: 'Chapters' }) }).locator('li');
  await expect(chapters).not.toHaveCount(0, { timeout: 120_000 });

  await page.getByPlaceholder(/ask a question/i).fill('Where does photosynthesis happen?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('chat-response')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('chat-citation')).toHaveCount(1);

  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByRole('status')).toHaveText('done', { timeout: 120_000 });
  await expect(page.locator('section', { hasText: 'Flashcards' }).locator('li')).not.toHaveCount(0, {
    timeout: 60_000,
  });

  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Good' }).click();
  await expect(page.getByText(/card\(s\) left today|Nothing due right now/)).toBeVisible();
});
