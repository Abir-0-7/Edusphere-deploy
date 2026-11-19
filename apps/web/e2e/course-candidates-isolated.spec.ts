import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const courses = [
  {
    name: 'SQL Query Foundations',
    slug: 'sql-query-foundations',
    example: 'SELECT product_id, name FROM products',
    practice: ['WHERE', 'coupon_code IS NULL', 'ORDER BY', 'HAVING', 'ON'],
    checkpoints: ['SELECT student_id FROM exams WHERE score >= 10', 'Yes', 1, 1, 3],
    lab: {
      kind: 'sql_query',
      actions: [
        'SELECT product_name, price FROM products WHERE active = TRUE ORDER BY price DESC, product_id ASC LIMIT 2;',
        'SELECT category, COUNT(*) AS product_count FROM products WHERE active = TRUE GROUP BY category HAVING COUNT(*) >= 2 ORDER BY category ASC;',
        'SELECT c.name, o.order_id, o.total FROM customers AS c INNER JOIN orders AS o ON o.customer_id = c.customer_id ORDER BY o.order_id ASC;',
      ],
    },
    assignment:
      'SELECT category, COUNT(*) AS product_count FROM products GROUP BY category ORDER BY category;\n' +
      'The group contains a count for every category. '.repeat(4),
  },
  {
    name: 'Git Foundations',
    slug: 'git-foundations',
    example: 'git add reports/summary.md',
    practice: [
      'git commit',
      'git diff --staged',
      'git switch -c feature/report',
      'main',
      'git log --oneline --graph',
    ],
    checkpoints: [
      'The previously staged heading',
      'git diff',
      'feature/change-1 only',
      'git add report-1.md',
      'git show 0000001',
    ],
    lab: {
      kind: 'git_shell',
      actions: [
        'git status',
        'git add reports/summary.md',
        'git diff --staged',
        'git commit -m "Add weekly summary"',
        'git switch -c feature/weekly-summary',
        'git log --oneline --graph',
      ],
    },
    assignment:
      'git status\ngit add reports/summary.md\ngit diff --staged\ngit commit -m "Add weekly summary"\n' +
      'I inspect history and check the branch before merge. '.repeat(3),
  },
];

async function checkAnswer(page: Page, answer: string | number) {
  const exercise = page.locator('section[aria-labelledby="exercise-title"]');
  if (typeof answer === 'number') {
    await exercise.getByLabel('Your answer').fill(String(answer));
  } else {
    await exercise.getByRole('radio', { name: answer, exact: true }).check();
  }
  const posted = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/attempts'),
  );
  await exercise.getByRole('button', { name: 'Check answer', exact: true }).click();
  const response = await posted;
  expect(response.ok()).toBe(true);
  return response.json();
}

for (const course of courses) {
  test(`${course.name}: enroll, practice, checkpoint, review, resume and finish`, async ({
    page,
    browser,
  }) => {
    const owner = `course-candidate-${randomUUID()}`;
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.addInitScript((id) => localStorage.setItem('fixture-learner', id), owner);

    await page.goto('/courses');
    const courseCard = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: course.name }) });
    await courseCard.getByRole('button', { name: 'View course' }).click();
    await expect(page).toHaveURL(new RegExp(`/courses/${course.slug}$`));
    await page.getByRole('button', { name: 'Enroll and begin' }).click();
    await expect(page).toHaveURL(/\?enrollment=/);
    const enrolledUrl = page.url();
    await expect(page.locator('pre code').filter({ hasText: course.example })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Source references' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open this course in your library' })).toHaveAttribute(
      'href',
      /^\/document\//,
    );

    for (const action of course.lab.actions) {
      if (course.lab.kind === 'sql_query') {
        await page
          .getByRole('button', { name: new RegExp(`^${course.lab.actions.indexOf(action) + 1}\\.`) })
          .click();
        await page.getByLabel('SQL query').fill(action);
      } else {
        await page.getByRole('textbox', { name: 'Command' }).fill(action);
      }
      const labResponse = page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url().endsWith('/labs'),
      );
      await page
        .getByRole('button', {
          name: course.lab.kind === 'sql_query' ? 'Check query' : 'Run in simulated shell',
        })
        .click();
      const result = await (await labResponse).json();
      expect(result.accepted).toBe(true);
      await expect(
        page.getByRole('status').filter({
          hasText: result.complete ? 'All lab tasks completed' : 'Accepted. Try the next authored task.',
        }),
      ).toBeVisible();
    }
    await expect(page.getByText('All lab tasks completed. This is practice evidence only.')).toBeVisible();

    for (const [index, answer] of course.checkpoints.entries()) {
      await expect(page.getByText(`Lesson ${index + 1} of 5`, { exact: true })).toBeVisible();
      const practice = await checkAnswer(page, course.practice[index]!);
      expect(practice).toMatchObject({ correct: true, independent: false, lesson_complete: false });
      await expect(page.getByRole('status').filter({ hasText: practice.feedback })).toBeVisible();
      await page.getByRole('button', { name: 'Independent checkpoint', exact: true }).click();
      const checkpoint = await checkAnswer(page, answer);
      expect(checkpoint).toMatchObject({ correct: true, independent: true, lesson_complete: true });
      await expect(page.getByRole('heading', { name: 'Checkpoint complete' })).toBeVisible();
      await expect(page.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute(
        'aria-valuenow',
        `${index + 1}`,
      );

      if (index === 0) {
        await page.getByRole('link', { name: 'Open flashcard review' }).click();
        await expect(page.getByRole('heading', { name: 'Flashcard review', exact: true })).toBeVisible();
        await expect(page.getByRole('status')).toContainText('1 card left today');
        await page.getByRole('button', { name: 'Show answer' }).click();
        const posted = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            /\/api\/flashcards\/[^/]+\/review$/.test(response.url()),
        );
        await page.getByRole('button', { name: 'Easy' }).click();
        const reviewed = await posted;
        expect(reviewed.ok()).toBe(true);
        expect(await reviewed.json()).toMatchObject({ repetitions: 1 });
        await expect(page.getByRole('status')).toContainText('0 cards left today');

        const secondDevice = await browser.newContext();
        try {
          await secondDevice.addInitScript((id) => localStorage.setItem('fixture-learner', id), owner);
          const returning = await secondDevice.newPage();
          await returning.goto(enrolledUrl);
          await expect(returning.getByRole('heading', { name: 'Checkpoint complete' })).toBeVisible();
          await expect(returning.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute(
            'aria-valuenow',
            '1',
          );
        } finally {
          await secondDevice.close();
        }
        await page.goto(enrolledUrl);
      }

      if (index + 1 < course.checkpoints.length) {
        await page.getByRole('button', { name: 'Continue to next lesson' }).click();
      }
    }

    await expect(page.getByText(/Course complete\./)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Assignment:/ })).toBeVisible();
    await page.getByLabel('Your work').fill(course.assignment);
    const assignmentResponse = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().endsWith('/assignments'),
    );
    await page.getByRole('button', { name: 'Save draft' }).click();
    expect((await (await assignmentResponse).json()).status).toBe('draft');
    await expect(page.getByRole('status').filter({ hasText: 'Assignment draft saved.' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Your work')).toHaveValue(course.assignment);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      elements: Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .sort((left, right) => right.scrollWidth - left.scrollWidth)
        .slice(0, 30)
        .map((node) => ({
          tag: node.tagName,
          className: node.className,
          text: node.innerText.slice(0, 120),
          width: node.getBoundingClientRect().width,
          scrollWidth: node.scrollWidth,
          position: getComputedStyle(node).position,
          overflow: getComputedStyle(node).overflow,
          css: getComputedStyle(node).cssText,
        })),
    }));
    expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.clientWidth);
    await page.getByRole('link', { name: 'All courses' }).click();
    await expect(courseCard.getByText('5 of 5 lessons complete')).toBeVisible();
    await expect(courseCard.getByRole('link', { name: 'Review course', exact: true })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });
}

test('course narration auto-continue pauses at checkpoints and can be interrupted', async ({ page }) => {
  await page.addInitScript(() => {
    let active: SpeechSynthesisUtterance | null = null;
    const host = window as unknown as { finishCourseNarration: () => boolean };
    host.finishCourseNarration = () => {
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
  await page.addInitScript((id) => localStorage.setItem('fixture-learner', id), `audio-${randomUUID()}`);
  await page.goto('/courses');
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Python Foundations' }) });
  await card.getByRole('button', { name: 'View course' }).click();
  await page.getByRole('button', { name: 'Enroll and begin' }).click();
  await expect(page).toHaveURL(/\?enrollment=/);

  await page.getByRole('checkbox', { name: 'Auto-continue after lesson audio' }).check();
  await page.getByRole('button', { name: 'Listen' }).click();
  expect(
    await page.evaluate(() =>
      (window as unknown as { finishCourseNarration: () => boolean }).finishCourseNarration(),
    ),
  ).toBe(true);
  await expect(page.getByRole('status')).toContainText('Auto-continue paused at the lesson question.');
  await expect(page.getByText('Lesson 1 of 5', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Listen' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  expect(
    await page.evaluate(() =>
      (window as unknown as { finishCourseNarration: () => boolean }).finishCourseNarration(),
    ),
  ).toBe(false);
  await expect(page.getByRole('status')).toHaveText('Audio stopped.');
  await expect(page.getByText('Lesson 1 of 5', { exact: true })).toBeVisible();
});
