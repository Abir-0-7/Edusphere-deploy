import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CodeReviewResponseSchema, SessionResponseSchema } from '@studyvault/types';
import { inspectLocalScreen, keyboardTo } from './helpers/local-accessibility';

const review = CodeReviewResponseSchema.parse({
  time_complexity: 'O(n)',
  space_complexity: 'O(1)',
  explanation: 'Every input value is visited.',
  assumptions: ['n is the number of scalar values; worst case; printing has bounded cost.'],
  steps: ['Count n loop iterations.', 'Each visit uses constant auxiliary memory.'],
  notes: [{ line: 1, note: 'Visit the collection once.' }],
  improvements: [],
});
const course = SessionResponseSchema.parse(
  JSON.parse(readFileSync('e2e/fixtures/code-review/course.json', 'utf8')),
);

test('qualified review and learner reference reach chosen course lesson at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let savedNote = '';
  let submitted = false;
  await page.route('**/api/learning-service/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/learning-service', '');
    expect(request.headers().authorization).toBe('Bearer learner-a');
    if (path === '/api/code-review') {
      const body = request.postDataJSON();
      expect(body.context).toBe('n is list length');
      expect(body.reference).toBeUndefined();
      return route.fulfill({ json: review });
    }
    if (path === '/api/course-enrollments') return route.fulfill({ json: { sessions: [course] } });
    if (request.method() === 'PUT') {
      submitted = true;
      const body = request.postDataJSON();
      expect(body.revision).toBe(course.revision);
      expect(body.bookmarks).toEqual(course.bookmarks);
      const note = body.notes.find(
        (entry: { lesson_id: string }) => entry.lesson_id === course.lessons[1]!.id,
      );
      savedNote = note.text;
      expect(savedNote).toContain('Learner reference (unverified): Book chapter 3, page 12');
      expect(savedNote).toContain('Assumptions:');
      expect(savedNote).toContain('Reasoning steps:');
      expect(savedNote).toContain('code was not executed');
      return route.fulfill({ json: { ...course, revision: course.revision + 1, notes: body.notes } });
    }
    return route.fulfill({ json: course });
  });
  await page.goto('/');
  const language = page.getByRole('combobox', { name: 'Code language' });
  await keyboardTo(page, language);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Code to review', exact: true })).toBeFocused();
  await page.getByLabel('Code to review').fill('for x in values:\n    print(x)');
  await page.getByLabel('Input sizes and helper costs').fill('n is list length');
  await page.getByLabel('Reference for your lesson note').fill('Book chapter 3, page 12');
  await keyboardTo(page, page.getByRole('button', { name: 'Analyse', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Assumptions', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reasoning steps', exact: true })).toBeVisible();
  await expect(page.getByText('Line 1:', { exact: true })).toBeVisible();
  await expect(page.getByText(/Runtime measurements on finite inputs/)).toBeVisible();
  await page.getByRole('button', { name: 'Choose a course note' }).click();
  await page.getByLabel('Course enrollment').selectOption(course.id);
  await page.getByRole('combobox', { name: 'Lesson', exact: true }).selectOption(course.lessons[1]!.id);
  await page.getByRole('button', { name: 'Add to lesson notes' }).click();
  await expect(page.getByRole('status')).toContainText('Note saved');
  expect(submitted && Boolean(savedNote)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/code-review/qualified-handoff-390.png', fullPage: true });
  await inspectLocalScreen(page, 'big-o', page.locator('section[aria-labelledby="code-review-title"]'));
  expect(errors).toEqual([]);
});

test('provider failure and malformed response preserve code for correction and retry', async ({ page }) => {
  let attempt = 0;
  await page.route('**/api/learning-service/api/code-review', (route) => {
    attempt++;
    return route.fulfill(
      attempt === 1
        ? {
            status: 503,
            json: { error: { code: 'internal', message: 'Provider unavailable; retry later.' } },
          }
        : attempt === 2
          ? { json: { ...review, assumptions: [] } }
          : { json: review },
    );
  });
  await page.goto('/');
  await page.getByLabel('Code to review').fill('for x in values: print(x)');
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Provider unavailable');
  await expect(page.getByLabel('Code to review')).toHaveValue('for x in values: print(x)');
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('invalid service response');
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Assumptions', exact: true })).toBeVisible();
});

test('edited inputs, cancellation and account change discard late responses', async ({ page }) => {
  await page.addInitScript((response) => {
    const original = window.fetch;
    const pending: ((value: Response) => void)[] = [];
    Object.assign(window, {
      finishCodeReview: () => pending.shift()?.(new Response(JSON.stringify(response))),
    });
    window.fetch = (input, init) =>
      String(input).endsWith('/api/code-review')
        ? new Promise<Response>((resolve) => pending.push(resolve))
        : original(input, init);
  }, review);
  const finish = () =>
    page.evaluate(() => (window as unknown as { finishCodeReview(): void }).finishCodeReview());
  await page.goto('/');
  await page.getByLabel('Code to review').fill('old code');
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await page.getByLabel('Code to review').fill('new code');
  await finish();
  await expect(page.getByLabel('Code review result')).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel review' }).click();
  await finish();
  await expect(page.getByRole('alert')).toContainText('cancelled');
  await expect(page.getByLabel('Code review result')).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await page.getByRole('button', { name: 'Switch fixture account' }).click();
  await finish();
  await expect(page.getByLabel('Code to review')).toHaveValue('');
  await expect(page.getByLabel('Code review result')).toHaveCount(0);
});
