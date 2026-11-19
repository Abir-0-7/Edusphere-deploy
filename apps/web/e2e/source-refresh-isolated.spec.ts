import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  GenerationListResponseSchema,
  GenerationRunSchema,
  OutlineRecordSchema,
  SessionResponseSchema,
} from '@studyvault/types';

const api = 'http://127.0.0.1:4342';
const owner = (name: string) => `generation-fixture-${name}`;
const headers = (name: string) => ({ Authorization: `Bearer ${owner(name)}` });
const screenshots = '.tmp-playwright/f06';

async function open(page: Page, name: string, path: string) {
  await page.addInitScript((account) => localStorage.setItem('fixture-learner', account), owner(name));
  await page.goto(path);
}

async function generation(request: APIRequestContext, name: string, id: string) {
  const response = await request.get(`${api}/api/course-generations/${id}`, { headers: headers(name) });
  expect(response.ok()).toBe(true);
  return GenerationRunSchema.parse(await response.json());
}

async function capture(page: Page, name: string) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);
  await page.screenshot({ path: `${screenshots}/${name}-390.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);
  await page.screenshot({ path: `${screenshots}/${name}-1440.png` });
}

test('source changes flag cards, maps and lessons, and selective refresh keeps both saved histories', async ({
  page,
  request,
}) => {
  const name = 'f06-refresh';
  await open(page, name, '/');
  await page.getByRole('button', { name: 'Preview generation budget' }).click();
  await page.getByLabel('I accept this generation budget and understand the drafts need review.').check();
  await page.getByRole('button', { name: 'Start private lesson generation' }).click();
  const progress = page.getByRole('region', { name: 'Saved generation progress' });
  await expect(progress).toContainText('Generation done: 2/2 stages saved', { timeout: 25_000 });
  const originalId = await page.getByLabel('Saved lesson generation').inputValue();
  const original = await generation(request, name, originalId);

  async function edit(index: number, objective: string, explanation: string) {
    await progress.getByText(`Review saved lesson ${index}`, { exact: true }).click();
    const stage = progress.locator('ol > li').nth(index - 1);
    await stage.getByRole('button', { name: 'Open private lesson editor', exact: true }).click();
    const editor = page.getByRole('region', { name: `Private lesson editor ${objective}` });
    await editor.getByRole('textbox', { name: 'Explanation', exact: true }).fill(explanation);
    await editor.getByRole('button', { name: 'Save personal lesson version' }).click();
    await expect(editor.getByRole('status')).toContainText('Personal lesson version saved.');
    await stage.getByRole('button', { name: 'Close private lesson editor' }).click();
  }

  const changedEdit = 'My personal explanation for the original energy lesson.';
  const retainedEdit = 'My personal explanation for the unchanged momentum lesson.';
  await edit(1, 'energy', changedEdit);
  await edit(2, 'momentum', retainedEdit);

  const outlineResponse = await request.get(`${api}/api/fixture/approved-outline`, {
    headers: headers(name),
  });
  const outline = OutlineRecordSchema.parse(await outlineResponse.json());
  const replacementResponse = await request.post(`${api}/api/fixture/replace-source/${outline.id}`, {
    headers: headers(name),
  });
  expect(replacementResponse.ok(), await replacementResponse.text()).toBe(true);
  const replacement = (await replacementResponse.json()) as { old: string; new: string; document: string };
  await page.getByRole('button', { name: 'Load latest approved fixture outline' }).click();
  await progress.getByRole('button', { name: 'Review source changes and refresh' }).click();
  await page.getByLabel('Before source version').selectOption(replacement.old);
  await page.getByLabel('After source version').selectOption(replacement.new);
  await page.getByRole('button', { name: 'Preview source impact' }).click();
  const report = page.getByRole('region', { name: 'Source impact report' });
  await expect(report).toContainText('card: Where does conserved energy go?');
  await expect(report).toContainText('map node: Energy boundary');
  await expect(report).toContainText('map edge: contains');
  await expect(report).toContainText('generated lesson: Explain energy conservation');
  await expect(report).toContainText('Saved edits are present.');
  await expect(report.getByRole('link').first()).toHaveAttribute('href', `/document/${replacement.document}`);
  await report.getByText('Inspect changed source excerpts', { exact: true }).click();
  await expect(report).toContainText('An isolated system conserves energy even when energy changes form.');
  await report.scrollIntoViewIfNeeded();
  await capture(page, 'source-impact');

  await page.getByRole('button', { name: 'Preview selective refresh budget' }).click();
  const copy = page.getByRole('region', { name: 'Selective refresh preview' });
  await expect(copy).toContainText('energy: Generate a fresh proposal');
  await expect(copy).toContainText('momentum: Reuse saved stage');
  await expect(copy).toContainText('Personal edits remain in the parent.');
  await expect(copy).toContainText('Personal edit history will be copied');
  const create = copy.getByRole('button', { name: 'Create refreshed private run' });
  await expect(create).toBeDisabled();
  await copy.getByRole('checkbox', { name: /I accept this bounded refresh/ }).check();
  await create.click();
  await expect(progress).toContainText('This private run uses the reviewed refresh.');
  await expect(progress).toContainText('Generation done: 2/2 stages saved', { timeout: 25_000 });
  const childId = await page.getByLabel('Saved lesson generation').inputValue();
  expect(childId).not.toBe(originalId);
  const child = await generation(request, name, childId);
  expect(child.parent_run_id).toBe(originalId);
  expect(child.stages.filter((stage) => stage.reuse).map((stage) => stage.id)).toEqual(['momentum']);
  const provider = await request.get(`${api}/api/fixture/provider-state`, { headers: headers(name) });
  expect((await provider.json()).calls).toEqual(['energy', 'momentum', 'energy']);
  expect((await generation(request, name, originalId)).stages).toEqual(original.stages);
  await progress.getByText('Review saved lesson 2', { exact: true }).click();
  await progress
    .locator('ol > li')
    .nth(1)
    .getByRole('button', { name: 'Open private lesson editor' })
    .click();
  const copiedEditor = page.getByRole('region', { name: 'Private lesson editor momentum' });
  await expect(copiedEditor.getByRole('textbox', { name: 'Explanation', exact: true })).toHaveValue(
    retainedEdit,
  );
  await copiedEditor.getByText('Inspect prior personal versions (1)').click();
  await expect(copiedEditor).toContainText(originalId);

  await page.getByLabel('Saved lesson generation').selectOption(originalId);
  await page.getByRole('button', { name: 'Open saved lesson drafts' }).click();
  await expect(progress).toContainText('Generation done: 2/2 stages saved');
  const parentEdits = await request.get(`${api}/api/course-generations/${originalId}/lesson-edits`, {
    headers: headers(name),
  });
  expect(
    (await parentEdits.json()).items.map(
      (entry: { output: { explanation: string } }) => entry.output.explanation,
    ),
  ).toEqual(expect.arrayContaining([changedEdit, retainedEdit]));
  const foreign = await request.get(`${api}/api/course-generations/${originalId}/lesson-edits`, {
    headers: headers('f06-other'),
  });
  expect(foreign.status()).toBe(404);
  const list = await request.get(`${api}/api/course-generations`, { headers: headers(name) });
  expect(GenerationListResponseSchema.parse(await list.json()).items.map((item) => item.id)).toEqual(
    expect.arrayContaining([originalId, childId]),
  );
});

test('course upgrade waits for explicit acceptance, copies compatible progress and leaves the old release usable', async ({
  page,
  request,
}) => {
  const name = 'f06-upgrade';
  const fixture = await request.get(`${api}/api/fixture/release`, { headers: headers(name) });
  const {
    slug,
    version,
    checkpoint_answer: answer,
  } = (await fixture.json()) as {
    slug: string;
    version: string;
    checkpoint_answer: string | number | string[];
  };
  const enrolled = await request.post(`${api}/api/courses/${slug}/enroll`, {
    headers: headers(name),
    data: {},
  });
  expect(enrolled.ok(), await enrolled.text()).toBe(true);
  const old = SessionResponseSchema.parse(await enrolled.json());
  expect(old.lesson.checkpoint).toBeTruthy();
  const attempt = await request.post(`${api}/api/course-enrollments/${old.id}/attempts`, {
    headers: headers(name),
    data: { id: randomUUID(), revision: old.revision, exercise_id: old.lesson.checkpoint?.id, answer },
  });
  expect(attempt.ok(), await attempt.text()).toBe(true);
  expect((await attempt.json()).lesson_complete).toBe(true);
  const published = await request.post(`${api}/api/fixture/publish-replacement`, { headers: headers(name) });
  expect(published.ok(), await published.text()).toBe(true);
  const target = (await published.json()) as { id: string; version: string };

  const oldPath = `/courses/${slug}?enrollment=${old.id}`;
  await open(page, name, oldPath);
  const upgrade = page.getByRole('region', { name: 'Course release upgrade' });
  await expect(upgrade).toContainText(`This enrollment stays on release ${version}`);
  await expect(upgrade).toContainText(`Release ${target.version} is available.`);
  const inspect = upgrade.getByRole('button', { name: 'Preview course upgrade' });
  await inspect.click();
  const review = upgrade.getByRole('region', { name: 'Course upgrade impact' });
  await expect(review).toContainText('1 unchanged completed lesson checkpoints retained');
  await review.getByText('Which lessons require a new checkpoint?').click();
  await expect(review).toContainText('Lesson material or checkpoint changed');
  const accept = review.getByRole('button', { name: 'Accept upgrade and open new enrollment' });
  await expect(accept).toBeDisabled();
  const note = 'Compatible learner notes stay with my original and upgraded enrollments.';
  await page.getByLabel('Lesson note').fill(note);
  await expect(review).toContainText(
    'Save your notes, bookmarks and project edits before accepting an upgrade.',
  );
  await expect(review.getByRole('checkbox')).toBeDisabled();
  await page.getByRole('button', { name: 'Save notes and bookmarks' }).click();
  await expect(upgrade).toContainText('Your progress changed. Preview again before accepting an upgrade.');
  await inspect.click();
  await expect(review).toContainText('1 saved notes');
  await expect(accept).toBeDisabled();
  await review.scrollIntoViewIfNeeded();
  await capture(page, 'course-upgrade');

  await review.getByRole('checkbox').check();
  await accept.click();
  await expect(page).toHaveURL(new RegExp(`previous_enrollment=${old.id}$`));
  const nextId = new URL(page.url()).searchParams.get('enrollment');
  expect(nextId).not.toBe(old.id);
  const next = SessionResponseSchema.parse(
    await (await request.get(`${api}/api/course-enrollments/${nextId}`, { headers: headers(name) })).json(),
  );
  expect(next.release_id).toBe(target.id);
  expect(next.completed_lesson_ids).toEqual([old.lesson.id]);
  expect(next.notes[0]?.text).toBe(note);

  await page.getByRole('link', { name: 'Open previous enrollment and history' }).click();
  await expect(page).toHaveURL(new RegExp(`enrollment=${old.id}$`));
  await expect(page.getByLabel('Lesson note')).toHaveValue(note);
  await expect(page.getByRole('heading', { name: old.lesson.title, exact: true })).toBeVisible();
  await page.getByLabel('Lesson note').fill(`${note} Still editable.`);
  await page.getByRole('button', { name: 'Save notes and bookmarks' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Notes and bookmarks saved' })).toBeVisible();
  const unchangedTarget = SessionResponseSchema.parse(
    await (await request.get(`${api}/api/course-enrollments/${nextId}`, { headers: headers(name) })).json(),
  );
  expect(unchangedTarget.notes[0]?.text).toBe(note);

  await page.goto('/courses');
  await expect(page.getByRole('link', { name: 'Resume course', exact: true })).toHaveAttribute(
    'href',
    `/courses/${slug}?enrollment=${nextId}`,
  );
  await expect(page.getByRole('link', { name: 'Open previous enrollment', exact: true })).toHaveAttribute(
    'href',
    oldPath,
  );
});
