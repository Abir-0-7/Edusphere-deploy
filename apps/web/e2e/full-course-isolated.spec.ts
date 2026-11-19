import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';
import { SessionResponseSchema, type Answer, type SessionResponse } from '@studyvault/types';

const api = 'http://127.0.0.1:4338';
const output = path.join(process.cwd(), '.tmp-playwright', 'f05');
const vectorsSchema = z.strictObject({
  slug: z.string(),
  title: z.string(),
  lessons: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      practice_ids: z.array(z.string()),
      checkpoint_ids: z.array(z.string()),
    }),
  ),
  exercises: z.array(
    z.strictObject({ id: z.string(), answer: z.union([z.string(), z.number(), z.array(z.string())]) }),
  ),
  sections: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      prompt: z.string(),
      min_chars: z.number(),
      max_chars: z.number(),
    }),
  ),
  diagnostic: z.array(
    z.strictObject({ id: z.string(), prompt: z.string(), answer: z.union([z.string(), z.number()]) }),
  ),
});
const vectors = () =>
  vectorsSchema.parse(JSON.parse(fs.readFileSync(path.join(output, 'keys.json'), 'utf8')));

async function session(page: Page, owner: string, enrollmentId: string) {
  const response = await page.request.get(`${api}/api/course-enrollments/${enrollmentId}`, {
    headers: { Authorization: `Bearer ${owner}` },
  });
  expect(response.ok()).toBe(true);
  return SessionResponseSchema.parse(await response.json());
}

async function enroll(page: Page, owner: string) {
  const data = vectors();
  await page.addInitScript((id) => localStorage.setItem('fixture-learner', id), owner);
  await page.goto('/courses');
  const courseCard = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: data.title, exact: true }) });
  await expect(courseCard).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Python Foundations', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'PyTorch Fundamentals', exact: true })).toBeVisible();
  await courseCard.getByRole('button', { name: 'View course', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${data.slug}$`));
  await expect(page.getByRole('heading', { name: data.title, exact: true })).toBeVisible();
  for (const question of data.diagnostic)
    await page.getByLabel(question.prompt, { exact: true }).fill(String(question.answer));
  await page.getByRole('button', { name: 'Submit and enroll', exact: true }).click();
  await expect(page).toHaveURL(/\?enrollment=/);
  const id = new URL(page.url()).searchParams.get('enrollment');
  if (!id) throw new Error('Missing fixture enrollment ID');
  await expect(page.getByRole('button', { name: 'Independent checkpoint', exact: true })).toBeVisible();
  return id;
}

async function answer(page: Page, value: Answer) {
  const region = page.locator('section[aria-labelledby="exercise-title"]');
  if (typeof value === 'number') await region.getByLabel('Your answer', { exact: true }).fill(String(value));
  else
    for (const item of Array.isArray(value) ? value : [value]) {
      const choice = region.locator(`input[value=${JSON.stringify(item)}]`);
      await choice.check();
    }
  const posted = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/attempts'),
  );
  await region.getByRole('button', { name: 'Check answer', exact: true }).click();
  const response = await posted;
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{
    correct: boolean;
    independent: boolean;
    lesson_complete: boolean;
    course_complete: boolean;
  }>;
}

async function correctCurrent(page: Page, current: SessionResponse) {
  const exercise = current.lesson.checkpoint;
  if (!exercise) throw new Error('Missing active checkpoint');
  const key = vectors().exercises.find((item) => item.id === exercise.id);
  if (!key) throw new Error(`Missing private test key for ${exercise.id}`);
  await page.getByRole('button', { name: 'Independent checkpoint', exact: true }).click();
  return answer(page, key.answer);
}

function projectText(sectionId: string) {
  const content: Record<string, string> = {
    algorithm:
      'Validate every input record before calculating the report. Require stripped nonblank IDs and topics, unique normalized IDs, strict integer minutes from 1 to 180, and a Boolean completed field. Keep the input unchanged. Filter completed records, sum minutes by case-sensitive topic, sort by descending total then topic name, and return completed count, total, and ordered topic totals.',
    trace:
      'Five records contain Python 25 completed, SQL 40 incomplete, Python 35 completed, Math 20 completed, and SQL 30 completed. All are validated first. The completed records are the first, third, fourth and fifth: count 4 and total 110. The ordered topic report is Python 60, SQL 30, Math 20. The incomplete SQL record contributes nothing to the totals.',
    'test-plan':
      'Normal: the five-record example gives count 4, total 110, Python 60 / SQL 30 / Math 20. Empty input gives count 0, total 0 and no topics. All incomplete valid rows give the same empty report. Tie: completed Alpha 20 and Beta 20 order by topic ascending. Boundary: minutes 1 and 180 are accepted. Invalid Boolean minutes True must fail. Invalid minutes 0 or 181 must fail. Duplicate IDs after stripping must fail. A missing topic, blank ID, or invalid incomplete row must fail the whole report. Compare input before and after to detect mutation.',
    limitations:
      'This is a proposed text algorithm and manual trace, not executed code. I must still inspect each test and review the implementation against the stated contract. I used the linked course evidence for strict validation, filtering and aggregation. Completeness checks cannot establish correctness or rubric quality; a human review remains necessary. Topics are intentionally case-sensitive and normalized IDs are unique.',
  };
  return (
    content[sectionId] ??
    'Review the contract and explain each case before making a correctness claim. '.repeat(4)
  );
}

async function openProject(page: Page) {
  const toggle = page.getByText(/^Capstone project ·/);
  const details = toggle.locator('..');
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) await toggle.click();
  return page
    .getByRole('article')
    .filter({ has: page.getByText('Required capstone submission', { exact: true }) });
}

test('full course: module checkpoints, retained capstone draft, evidence and completion', async ({
  page,
}) => {
  const owner = `full-course-${randomUUID()}`;
  const id = await enroll(page, owner);
  const url = page.url();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const data = vectors();
  expect(data.lessons).toHaveLength(16);
  await expect(page.getByRole('list', { name: 'Module progress' }).locator('li')).toHaveCount(4);
  let project = await openProject(page);
  for (const field of data.sections)
    await project.getByLabel(field.title, { exact: true }).fill(projectText(field.id));
  const evidence = project.getByRole('group', { name: /Project evidence references/ });
  await evidence.getByRole('checkbox').first().check();
  await expect(project.getByRole('button', { name: 'Submit assignment', exact: true })).toBeDisabled();
  await project.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(project.getByRole('status')).toContainText('Assignment draft saved');
  await page.reload();
  project = await openProject(page);
  for (const field of data.sections)
    await expect(project.getByLabel(field.title, { exact: true })).toHaveValue(projectText(field.id));
  await project.getByText('Inspect rubric objectives and evidence', { exact: true }).click();
  await expect(project.getByText('Objectives:', { exact: false }).first()).toBeVisible();
  await expect(project.getByRole('button', { name: /Run|Check query/ })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await project.screenshot({ path: path.join(output, 'full-course-capstone-1440.png') });
  await page.setViewportSize({ width: 390, height: 844 });

  for (const [index, lesson] of data.lessons.entries()) {
    await expect(page.getByRole('heading', { name: lesson.title, exact: true })).toBeVisible();
    let current = await session(page, owner, id);
    expect(current.lesson.id).toBe(lesson.id);
    expect(current.lesson.checkpoint).not.toHaveProperty('answer');
    const practice = current.lesson.practice[0];
    const practiceKey = data.exercises.find((item) => item.id === practice?.id);
    if (!practiceKey) throw new Error('Missing private practice vector');
    await page.getByRole('button', { name: 'Practice', exact: true }).click();
    const practiceResult = await answer(page, practiceKey.answer);
    expect(practiceResult.correct).toBe(true);
    expect(practiceResult.independent || practiceResult.lesson_complete).toBe(false);
    current = await session(page, owner, id);
    if (index === 0) {
      await page.getByRole('button', { name: 'Independent checkpoint', exact: true }).click();
      const key = data.exercises.find((item) => item.id === current.lesson.checkpoint?.id);
      if (!key) throw new Error('Missing first checkpoint key');
      const wrong = typeof key.answer === 'number' ? key.answer + 99 : 'wrong-not-a-choice';
      if (typeof wrong === 'number') expect((await answer(page, wrong)).lesson_complete).toBe(false);
      const posted = page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url().endsWith('/assistance'),
      );
      await page.getByRole('button', { name: 'Reveal', exact: true }).click();
      expect((await posted).ok()).toBe(true);
      current = await session(page, owner, id);
      expect(current.completed_lesson_ids).toHaveLength(0);
    }
    const result = await correctCurrent(page, current);
    expect(result.correct && result.independent && result.lesson_complete).toBe(true);
    expect(result.course_complete).toBe(false);
    await expect(page.getByRole('heading', { name: 'Checkpoint complete', exact: true })).toBeVisible();
    if ([3, 7, 11, 15].includes(index)) {
      await expect(
        page
          .getByRole('list', { name: 'Module progress' })
          .locator('li')
          .nth(Math.floor(index / 4)),
      ).toContainText('4/4 lesson checkpoints complete');
    }
    if (index === 7) {
      await page.reload();
      await expect(page.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute(
        'aria-valuenow',
        '8',
      );
    }
    if (index < data.lessons.length - 1)
      await page.getByRole('button', { name: 'Continue to next lesson', exact: true }).click();
  }
  await expect(page.getByText(/Lesson checkpoints complete\. Submit the required capstone/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to next lesson', exact: true })).toHaveCount(0);
  project = await openProject(page);
  await expect(project.getByRole('button', { name: 'Submit assignment', exact: true })).toBeEnabled();
  await project.getByRole('button', { name: 'Submit assignment', exact: true }).click();
  await expect(project.getByRole('status')).toContainText('rubric has not been graded');
  await expect(
    page.getByText(/Learning activities complete\. Your capstone submission remains ungraded/),
  ).toBeVisible();
  await page.reload();
  expect((await session(page, owner, id)).status).toBe('completed');
  project = await openProject(page);
  await expect(project.getByText('Saved status: submitted', { exact: true })).toBeVisible();
  await project.screenshot({ path: path.join(output, 'full-course-capstone-390.png') });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
  await page.getByText(/^Capstone project ·/).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'full-course-progress-1440.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('list', { name: 'Module progress' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'full-course-progress-390.png') });
  expect(
    (
      await page.request.get(`${api}/api/course-enrollments/${id}`, {
        headers: { Authorization: `Bearer other-${owner}` },
      })
    ).status(),
  ).toBe(404);
  await page.goto(url);
  expect(browserErrors).toEqual([]);
});

test('project saves retain local edits and action IDs through lost responses and stale revisions', async ({
  page,
}) => {
  const owner = `full-course-recovery-${randomUUID()}`;
  const id = await enroll(page, owner);
  const data = vectors();
  let project = await openProject(page);
  const first = data.sections[0];
  if (!first) throw new Error('Missing capstone section');
  await project.getByLabel(first.title, { exact: true }).fill(projectText(first.id));
  const actionIds: string[] = [];
  let loseFirstResponse = true;
  await page.route('**/api/course-enrollments/*/assignments', async (route) => {
    actionIds.push((route.request().postDataJSON() as { id: string }).id);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await project.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(project.getByRole('alert')).toContainText('local edits are retained');
  await expect(project.getByLabel(first.title, { exact: true })).toHaveValue(projectText(first.id));
  await project.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(project.getByRole('status')).toContainText('Assignment draft saved');
  expect(actionIds).toHaveLength(2);
  expect(actionIds[0]).toBe(actionIds[1]);
  await page.unroute('**/api/course-enrollments/*/assignments');
  const saved = await session(page, owner, id);
  expect(saved.revision).toBe(1);
  const assignmentId = Object.keys(saved.assignment_status)[0];
  if (!assignmentId) throw new Error('Missing saved assignment status');
  const external = await page.request.put(`${api}/api/course-enrollments/${id}/assignments`, {
    headers: { Authorization: `Bearer ${owner}` },
    data: {
      id: randomUUID(),
      revision: saved.revision,
      assignment_id: assignmentId,
      action: 'save',
      sections: { [first.id]: 'A draft saved on a second device.' },
      evidence_ids: [],
      text: '',
    },
  });
  expect(external.ok()).toBe(true);
  const local = `${projectText(first.id)} I retain these local corrections.`;
  await project.getByLabel(first.title, { exact: true }).fill(local);
  await project.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(project.getByRole('alert')).toContainText('local edits are retained');
  await expect(project.getByLabel(first.title, { exact: true })).toHaveValue(local);
  await project.getByRole('button', { name: 'Refresh saved project state', exact: true }).click();
  await expect(project.getByRole('status')).toContainText('local edits are retained');
  await project.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(project.getByRole('status')).toContainText('Assignment draft saved');
  await page.reload();
  project = await openProject(page);
  await expect(project.getByLabel(first.title, { exact: true })).toHaveValue(local);
  expect((await session(page, owner, id)).assignment_status[assignmentId]).toBe('draft');
});
