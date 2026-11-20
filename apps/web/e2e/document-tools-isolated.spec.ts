import { expect, test } from '@playwright/test';

const questions = [{ question: 'What does photosynthesis produce?', expected_points: ['Sugars'] }];
test.beforeEach(async ({ page }) => {
  await page.route('**/concept-graph', (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: { code: 'not_found', message: 'Concept graph not found' },
      },
    }),
  );
  await page.route('**/mindmap', (route) =>
    route.fulfill({
      json: {
        nodes: [
          { id: 'root', label: 'Document', kind: 'root' },
          { id: 'ch1', label: 'Photosynthesis', kind: 'chapter' },
        ],
        edges: [{ source: 'root', target: 'ch1', label: '' }],
      },
    }),
  );
});

test('saved-summary document loads a map and completes viva via authenticated proxy; failed grades stay recoverable', async ({
  page,
}) => {
  await page.route('**/viva-questions', (route) => {
    expect(route.request().url()).toContain('/api/learning-service/api/documents/');
    expect(route.request().headers().authorization).toBe('Bearer document-tools-owner');
    return route.fulfill({ json: questions });
  });
  let attempts = 0;
  await page.route('**/viva-grade', (route) => {
    attempts += 1;
    expect(route.request().postDataJSON().answer).toBe('Sugars');
    return attempts === 1
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'internal', message: 'Grading is temporarily unavailable.' } },
        })
      : route.fulfill({ json: { score: 5, feedback: 'Correct.', covered: ['Sugars'], missed: [] } });
  });
  await page.goto('/');
  await expect(page.locator('body')).toContainText('Concept graph (generated preview)');
  await expect(page.getByRole('group', { name: 'Saved concept graph canvas' })).toBeVisible();
  await page.getByRole('button', { name: 'Start viva' }).click();
  await expect(page.getByText('Q1. What does photosynthesis produce?')).toBeVisible();
  await page.getByLabel('Type your answer').fill('Sugars');
  await page.getByRole('button', { name: 'Grade', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Grading is temporarily unavailable.');
  await expect(page.getByText(/Score/)).toHaveCount(0);
  await expect(page.getByLabel('Type your answer')).toHaveValue('Sugars');
  await page.getByRole('button', { name: 'Grade', exact: true }).click();
  await expect(page.getByText('Score 5/5')).toBeVisible();
});

test('viva reports authentication and malformed replies without blaming chapters', async ({ page }) => {
  let attempts = 0;
  await page.route('**/viva-questions', (route) => {
    attempts += 1;
    return attempts === 1
      ? route.fulfill({
          status: 401,
          json: { error: { code: 'unauthorized', message: 'Sign in again to continue.' } },
        })
      : route.fulfill({ json: { not: 'questions' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start viva' }).click();
  await expect(page.getByRole('alert')).toHaveText('Sign in again to continue.');
  await page.getByRole('button', { name: 'Start viva' }).click();
  await expect(page.getByRole('alert')).toContainText('invalid service response');
  await expect(page.getByText('try a document with chapters')).toHaveCount(0);
});

test('account and source changes cancel outstanding questions and discard previous answers', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  let calls = 0;
  await page.route('**/viva-questions', async (route) => {
    calls += 1;
    if (calls === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill({ json: questions }).catch(() => undefined);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start viva' }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('button', { name: 'Switch account' }).click();
  await expect(page.getByRole('button', { name: 'Start viva' })).toBeEnabled();
  release?.();
  await expect(page.getByText('Q1. What does photosynthesis produce?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start viva' }).click();
  await page.getByLabel('Type your answer').fill('Private previous answer');
  await page.getByRole('button', { name: 'Switch document' }).click();
  await expect(page.getByRole('button', { name: 'Start viva' })).toBeEnabled();
  await expect(page.getByLabel('Type your answer')).toHaveCount(0);
});
