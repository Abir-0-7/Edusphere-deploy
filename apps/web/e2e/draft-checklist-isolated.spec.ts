import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { DraftChecklistSchema, SessionResponseSchema } from '@studyvault/types';
import { inspectLocalScreen, keyboardTo } from './helpers/local-accessibility';

test('saves manual evidence, invalidates removed excerpts, reloads and keeps accounts separate', async ({
  page,
}) => {
  await page.goto('/');
  await keyboardTo(page, page.getByRole('textbox', { name: 'Checklist title', exact: true }));
  await expect(page.getByRole('textbox', { name: 'Checklist title', exact: true })).toBeFocused();
  await page.getByLabel('Checklist title').fill('Queue report');
  await page.getByLabel('Your draft', { exact: true }).fill('The queue serves the first item first.');
  await page.getByLabel('Criterion 1 evidence').fill('The queue serves the first item first.');
  await page.getByLabel('Criterion 1 status').selectOption('supported');
  await page.getByRole('button', { name: 'Save checklist', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 1');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download checklist', exact: true }).click();
  const saved = DraftChecklistSchema.parse(
    JSON.parse(await readFile((await (await download).path())!, 'utf8')),
  );
  expect(saved.criteria[0]?.status).toBe('supported');
  await inspectLocalScreen(page, 'draft-checklist', page.locator('section').first());
  await page.reload();
  await page.getByLabel('Saved checklist').selectOption(saved.id);
  await expect(page.getByLabel('Your draft', { exact: true })).toHaveValue(saved.draft);
  await expect(page.getByLabel('Criterion 1 status')).toHaveValue('supported');
  await page.getByLabel('Your draft', { exact: true }).fill('The draft has been revised.');
  await expect(page.getByLabel('Criterion 1 status')).toHaveValue('not-reviewed');
  await expect(page.getByLabel('Criterion 1 evidence')).toHaveValue('');
  await page.getByRole('button', { name: 'Save checklist', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 2');
  await page.getByLabel('Fixture account').selectOption('checklist-b');
  await expect(page.getByLabel('Saved checklist')).not.toContainText('Queue report');
  await expect(page.getByLabel('Your draft', { exact: true })).toHaveValue('');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp-playwright/e12/checklist-390.png', fullPage: true });
});

test('two tabs retain conflict edits and a separately saved copy', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Save checklist', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 1');
  const other = await context.newPage();
  await other.goto('/');
  await other.getByLabel('Saved checklist').selectOption({ label: 'Draft checklist (revision 1)' });
  await page.getByLabel('Checklist title').fill('First tab saved');
  await page.getByRole('button', { name: 'Save checklist', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 2');
  await other.getByLabel('Checklist title').fill('Second tab edits');
  await other.getByRole('button', { name: 'Save checklist', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('changed in another tab');
  await expect(other.getByLabel('Checklist title')).toHaveValue('Second tab edits');
  await other.getByRole('button', { name: 'Save separate copy', exact: true }).click();
  await expect(other.getByRole('status')).toContainText('Revision 1');
  await expect(other.getByLabel('Saved checklist')).toContainText('First tab saved');
  await expect(other.getByLabel('Saved checklist')).toContainText('Second tab edits');
  await other.getByRole('button', { name: 'Remove saved copy', exact: true }).click();
  await expect(other.getByRole('status')).toContainText('current text remains open');
  await expect(other.getByLabel('Saved checklist')).not.toContainText('Second tab edits');
  await expect(other.getByLabel('Checklist title')).toHaveValue('Second tab edits');
});

test('hands the reviewed criteria and evidence to the chosen course lesson', async ({ page }) => {
  // Contract-valid snapshot returned by the existing course fixture API, with no provider calls.
  const session = SessionResponseSchema.parse(
    JSON.parse(await readFile('e2e/fixtures/draft-checklist/session.json', 'utf8')),
  );
  let latest = session;
  await page.route('**/api/learning-service/api/course-enrollments**', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer checklist-a');
    const url = new URL(route.request().url());
    const normalizedPath = url.pathname.replace('/api/learning-service', '');
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        revision: number;
        notes: typeof session.notes;
        bookmarks: typeof session.bookmarks;
      };
      expect(body.revision).toBe(latest.revision);
      latest = { ...latest, notes: body.notes, bookmarks: body.bookmarks, revision: latest.revision + 1 };
      await route.fulfill({ json: latest });
      return;
    }
    await route.fulfill({
      json: normalizedPath === '/api/course-enrollments' ? { sessions: [latest] } : latest,
    });
  });
  await page.goto('/');
  await page.getByLabel('Checklist title').fill('Queue report');
  await page.getByLabel('Your draft', { exact: true }).fill('The queue serves the first item first.');
  await page.getByLabel('Criterion 1 evidence').fill('first item first');
  await page.getByLabel('Criterion 1 status').selectOption('supported');
  await page.getByRole('button', { name: 'Choose a course note', exact: true }).click();
  await page.getByLabel('Course enrollment').selectOption(session.id);
  await page.getByRole('button', { name: 'Add to lesson notes', exact: true }).click();
  await expect(page.getByText('Note saved.')).toBeVisible();
  expect(latest.notes[0]?.lesson_id).toBe(session.lesson.id);
  expect(latest.notes[0]?.text).toContain('Draft excerpt: first item first');
  expect(latest.notes[0]?.text).toContain('No automatic grade');
});
