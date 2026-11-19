import { expect, test } from '@playwright/test';

test('loads a bounded cached deck when disconnected and casual actions do not schedule reviews', async ({ page }) => {
  let reviewRequests = 0;
  await page.route('**/api/documents/**/flashcards**', (route) => route.abort('failed'));
  await page.route('**/api/flashcards/**/review', async (route) => {
    reviewRequests += 1;
    await route.fulfill({ status: 500, body: 'Unexpected scheduled review' });
  });

  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Offline copy · cached');
  await page.getByRole('button', { name: 'Study 1 cards' }).click();
  const viewer = page.getByRole('region', { name: 'Flashcard viewer' });
  await expect(viewer.getByRole('heading', { name: 'Study viewer' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(viewer.getByText('The previously cached deck remains available for casual study.')).toBeVisible();
  await viewer.getByRole('button', { name: 'Mark missed' }).click();
  await viewer.getByRole('button', { name: 'Practice missed (1)' }).click();
  expect(reviewRequests).toBe(0);
});
