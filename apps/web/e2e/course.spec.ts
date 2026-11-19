import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const pythonSteps = [
  { practice: 11, checkpoint: 13 },
  { practice: 'advanced', checkpoint: 'mild' },
  { practice: 6, checkpoint: 9 },
  { practice: 10, checkpoint: 13 },
  { practice: 5, checkpoint: 14 },
];

const pytorchSteps = [
  { practice: 6, checkpoint: 8 },
  { practice: 'Yes', checkpoint: 4 },
  { practice: 12, checkpoint: 15 },
  { practice: -6, checkpoint: 6 },
  { practice: 'optimizer.step', checkpoint: 2 },
];

async function enterCourse(page: Page, slug: string, owner: string) {
  await page.addInitScript((id) => localStorage.setItem('fixture-learner', id), owner);
  await page.goto('/courses');
  const course = page.getByRole('article').filter({
    has: page.getByRole('heading', {
      name: slug === 'python-foundations' ? 'Python Foundations' : 'PyTorch Fundamentals',
    }),
  });
  await course.getByRole('button', { name: 'View course' }).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${slug}$`));
  return course;
}

async function completeCourse(
  page: Page,
  steps: Array<{ practice: number | string; checkpoint: number | string }>,
  startLesson = 0,
) {
  for (const [index, step] of steps.entries()) {
    await expect(page.getByText(`Lesson ${startLesson + index + 1} of 5`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Practice', exact: true }).click();
    const practice = page.locator('section[aria-labelledby="exercise-title"]');
    if (typeof step.practice === 'number')
      await practice.getByLabel('Your answer').fill(String(step.practice));
    else await practice.getByRole('radio', { name: step.practice, exact: true }).check();
    const practiceResult = page.waitForResponse(
      (item) => item.request().method() === 'POST' && item.url().endsWith('/attempts'),
    );
    await practice.getByRole('button', { name: 'Check answer' }).click();
    expect(await (await practiceResult).json()).toMatchObject({
      correct: true,
      independent: false,
      lesson_complete: false,
    });

    await page.getByRole('button', { name: 'Independent checkpoint', exact: true }).click();
    const checkpoint = page.locator('section[aria-labelledby="exercise-title"]');
    if (typeof step.checkpoint === 'number')
      await checkpoint.getByLabel('Your answer').fill(String(step.checkpoint));
    else await checkpoint.getByRole('radio', { name: step.checkpoint, exact: true }).check();
    const checkpointResult = page.waitForResponse(
      (item) => item.request().method() === 'POST' && item.url().endsWith('/attempts'),
    );
    await checkpoint.getByRole('button', { name: 'Check answer' }).click();
    expect(await (await checkpointResult).json()).toMatchObject({
      correct: true,
      independent: true,
      lesson_complete: true,
    });
    await expect(page.getByRole('heading', { name: 'Checkpoint complete' })).toBeVisible();
    if (index + 1 < steps.length) await page.getByRole('button', { name: 'Continue to next lesson' }).click();
  }
  await expect(page.getByText(/Course complete\./)).toBeVisible();
}

test('Python Foundations: enroll, checkpoint, review handoff, and resume', async ({ page, browser }) => {
  const owner = `python-course-${randomUUID()}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const course = await enterCourse(page, 'python-foundations', owner);
  await page.getByRole('button', { name: 'Enroll and begin' }).click();
  await expect(page).toHaveURL(/\?enrollment=/);
  const enrollmentUrl = page.url();
  await expect(
    page.locator('pre code').filter({ hasText: 'total_items = boxes * items_per_box + loose_items' }),
  ).toBeVisible();

  const practice = page.locator('section[aria-labelledby="exercise-title"]');
  await practice.getByLabel('Your answer').fill('-1');
  const wrongResponse = page.waitForResponse(
    (item) => item.request().method() === 'POST' && item.url().endsWith('/attempts'),
  );
  await practice.getByRole('button', { name: 'Check answer' }).click();
  expect((await (await wrongResponse).json()).correct).toBe(false);
  await expect(page.getByRole('status').filter({ hasText: 'incorrect' })).toBeVisible();

  const practiceResult = page.waitForResponse(
    (item) => item.request().method() === 'POST' && item.url().endsWith('/attempts'),
  );
  await practice.getByLabel('Your answer').fill('11');
  await practice.getByRole('button', { name: 'Check answer' }).click();
  expect(await (await practiceResult).json()).toMatchObject({
    correct: true,
    independent: false,
    lesson_complete: false,
  });
  await page.getByRole('button', { name: 'Independent checkpoint', exact: true }).click();
  const checkpoint = page.locator('section[aria-labelledby="exercise-title"]');
  await checkpoint.getByLabel('Your answer').fill('13');
  const rightResponse = page.waitForResponse(
    (item) => item.request().method() === 'POST' && item.url().endsWith('/attempts'),
  );
  await checkpoint.getByRole('button', { name: 'Check answer' }).click();
  expect((await (await rightResponse).json()).independent).toBe(true);
  await expect(page.getByRole('heading', { name: 'Checkpoint complete' })).toBeVisible();

  const secondDevice = await browser.newContext();
  try {
    await secondDevice.addInitScript((id) => localStorage.setItem('fixture-learner', id), owner);
    const returning = await secondDevice.newPage();
    await returning.goto(enrollmentUrl);
    await expect(returning.getByRole('heading', { name: 'Checkpoint complete' })).toBeVisible();
    await expect(returning.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
  } finally {
    await secondDevice.close();
  }
  await page.goto(enrollmentUrl);
  await page.getByRole('link', { name: 'Open flashcard review' }).click();
  await expect(page.getByRole('heading', { name: 'Flashcard review', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('1 card left today');
  await page.getByRole('button', { name: 'Show answer' }).click();
  const review = page.waitForResponse(
    (item) => item.request().method() === 'POST' && /\/api\/flashcards\/[^/]+\/review$/.test(item.url()),
  );
  await page.getByRole('button', { name: 'Easy' }).click();
  expect((await review).ok()).toBe(true);
  await expect(page.getByText(/Your review session is complete/)).toBeVisible();
  await page.goto('/courses');
  await expect(course.getByText('1 of 5 lessons complete')).toBeVisible();
  expect(errors).toEqual([]);

  await page.goto(enrollmentUrl);
  await page.getByRole('button', { name: 'Continue to next lesson' }).click();
  await completeCourse(page, pythonSteps.slice(1), 1);
});

test('PyTorch Fundamentals: diagnostic unlock, practice path, and review handoff', async ({ page }) => {
  await enterCourse(page, 'pytorch-fundamentals', `pytorch-course-${randomUUID()}`);
  const prompts = [14, 'true', 9, 7, 6];
  const questions = page.locator('fieldset').filter({ hasText: 'Optional prerequisite diagnostic' });
  for (const [index, value] of prompts.entries()) {
    const input = questions.locator('input').nth(index);
    await input.fill(String(value));
  }
  await page.getByRole('button', { name: 'Submit and enroll' }).click();
  await expect(page).toHaveURL(/\?enrollment=/);
  await expect(page.locator('pre code').filter({ hasText: 'illustrative shape: (2, 3)' })).toBeVisible();
  await completeCourse(page, pytorchSteps);
  await page.getByRole('link', { name: 'Open flashcard review' }).click();
  await expect(page.getByRole('heading', { name: 'Flashcard review', exact: true })).toBeVisible();
});

test('course audio auto-continue pauses at unanswered checkpoints and stops on interruption', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let active: SpeechSynthesisUtterance | null = null;
    const host = window as unknown as { finishNarration: () => boolean };
    host.finishNarration = () => {
      const utterance = active;
      active = null;
      if (!utterance?.onend) return false;
      utterance.onend(new Event('end') as SpeechSynthesisEvent);
      return true;
    };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: () => {
          active = null;
        },
        speak: (utterance: SpeechSynthesisUtterance) => {
          active = utterance;
        },
      },
    });
  });
  await enterCourse(page, 'python-foundations', `audio-${randomUUID()}`);
  await page.getByRole('button', { name: 'Enroll and begin' }).click();
  await expect(page).toHaveURL(/\?enrollment=/);
  await page.getByRole('checkbox', { name: 'Auto-continue after lesson audio' }).check();
  await page.getByRole('button', { name: 'Listen' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { finishNarration: () => boolean }).finishNarration()),
  ).toBe(true);
  await expect(page.getByRole('status')).toContainText('Auto-continue paused at the lesson question.');
  await expect(page.getByText('Lesson 1 of 5', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Listen' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  expect(
    await page.evaluate(() => (window as unknown as { finishNarration: () => boolean }).finishNarration()),
  ).toBe(false);
  await expect(page.getByRole('status')).toHaveText('Audio stopped.');
});
