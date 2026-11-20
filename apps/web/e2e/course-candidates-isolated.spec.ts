import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { CourseChatRequestSchema, SessionResponseSchema } from '@studyvault/types';

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

async function routeLearningServiceToFixture(page: Page) {
  await page.route('**/api/learning-service/**', async (route) => {
    const upstream = route
      .request()
      .url()
      .replace('http://127.0.0.1:4324/api/learning-service', 'http://127.0.0.1:4325');
    await route.fulfill({ response: await route.fetch({ url: upstream }) });
  });
}

const publishedCourseNames = [
  'Python Foundations',
  'PyTorch Fundamentals',
  'SQL Query Foundations',
  'Git Foundations',
  'Practical Python Foundations',
];

async function expectPublishedCatalog(page: Page) {
  await expect(page.getByRole('article')).toHaveCount(publishedCourseNames.length);
  for (const name of publishedCourseNames) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
}

test('the four existing courses and reviewed full course are available in the catalog', async ({ page }) => {
  await routeLearningServiceToFixture(page);
  await page.addInitScript((id) => localStorage.setItem('fixture-learner', id), `catalog-${randomUUID()}`);
  await page.goto('/courses');

  await expectPublishedCatalog(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('There are no published courses yet.')).toHaveCount(0);
});

test('catalog load failure offers retry without claiming that no courses are published', async ({ page }) => {
  await routeLearningServiceToFixture(page);
  let catalogRequests = 0;
  await page.route('**/api/learning-service/api/courses', async (route) => {
    catalogRequests += 1;
    if (catalogRequests === 1) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Not Found' }),
      });
      return;
    }
    await route.fallback();
  });
  await page.addInitScript((id) => localStorage.setItem('fixture-learner', id), `retry-${randomUUID()}`);
  await page.goto('/courses');

  await expect(page.getByRole('alert')).toContainText('Course request failed (404).');
  await expect(page.getByText('There are no published courses yet.')).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry loading courses' }).click();

  await expectPublishedCatalog(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(catalogRequests).toBe(2);
});

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
    await routeLearningServiceToFixture(page);
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
          await routeLearningServiceToFixture(returning);
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

async function openTutor(page: Page) {
  await routeLearningServiceToFixture(page);
  const owner = `tutor-${randomUUID()}`;
  await page.addInitScript((id) => localStorage.setItem('fixture-learner', id), owner);
  await page.goto('/courses/python-foundations');
  await page.getByRole('button', { name: 'Enroll and begin', exact: true }).click();
  await expect(page).toHaveURL(/\?enrollment=/);
  const id = new URL(page.url()).searchParams.get('enrollment');
  if (!id) throw new Error('Missing tutor fixture enrollment');
  const tutor = page.getByRole('region', { name: 'Ask the course tutor', exact: true });
  await expect(tutor).toBeVisible();
  const readSession = async () => {
    const response = await page.request.get(`http://127.0.0.1:4325/api/course-enrollments/${id}`, {
      headers: { Authorization: `Bearer ${owner}` },
    });
    expect(response.ok()).toBe(true);
    return SessionResponseSchema.parse(await response.json());
  };
  return { tutor, readSession };
}

test('course tutor suggestions remain editable, cite lesson evidence and support follow-ups', async ({
  page,
}, testInfo) => {
  const { tutor, readSession } = await openTutor(page);
  const input = tutor.getByLabel('Your question', { exact: true });
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/tutor/stream')) requests.push(request.url());
  });
  await expect(tutor.getByRole('button', { name: 'Go deeper', exact: true })).toHaveCount(0);
  await tutor.getByRole('button', { name: 'Explain simply', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('Explain this lesson in simpler terms.');
  await expect(input).toBeFocused();
  await expect(tutor.getByRole('button', { name: 'Show a worked example', exact: true })).toBeDisabled();
  await input.fill('My own editable question');
  expect(requests).toHaveLength(0);
  expect((await readSession()).conversation).toEqual([]);
  await input.fill('Explain this lesson in simpler terms.');
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  const conversation = tutor.getByRole('list', { name: 'Course tutor conversation' });
  await expect(conversation.locator(':scope > li')).toHaveCount(2);
  await expect(conversation.locator(':scope > li').last()).toContainText(
    'The AI tutor is temporarily unavailable. Related excerpt from this lesson:',
  );
  await expect(input).toHaveValue('');
  await expect(tutor.getByRole('button', { name: 'Go deeper', exact: true })).toBeVisible();
  const saved = await readSession();
  expect(saved.conversation[1]?.evidence_ids.length).toBeGreaterThan(0);
  await tutor.getByText('Sources used', { exact: true }).click();
  await expect(tutor.locator('details[open]')).toBeVisible();
  await tutor.screenshot({ path: testInfo.outputPath('course-tutor-390.png') });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await tutor.screenshot({ path: testInfo.outputPath('course-tutor-1440.png') });

  await page.reload();
  await expect(conversation.locator(':scope > li')).toHaveCount(2);
  await tutor.getByRole('button', { name: 'Go deeper', exact: true }).click();
  await expect(input).toHaveValue('Why does that matter?');
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await expect(conversation.locator(':scope > li')).toHaveCount(4);
  const followed = await readSession();
  expect(followed.conversation[3]?.evidence_ids).toEqual(saved.conversation[1]?.evidence_ids);
  await input.fill('Who won the intergalactic tournament?');
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await expect(conversation.locator(':scope > li')).toHaveCount(6);
  await expect(conversation.locator(':scope > li').last()).toContainText(
    "I don't know based on this lesson.",
  );
  await expect(tutor.getByRole('button', { name: 'Go deeper', exact: true })).toHaveCount(0);
});

test('course tutor preserves failed question drafts and reuses the request ID when retried', async ({
  page,
}) => {
  const { tutor, readSession } = await openTutor(page);
  const ids: string[] = [];
  await page.route('**/api/course-enrollments/*/tutor/stream', async (route) => {
    const body = CourseChatRequestSchema.parse(route.request().postDataJSON());
    ids.push(body.id);
    if (ids.length === 1) await route.abort('failed');
    else await route.continue();
  });
  const input = tutor.getByLabel('Your question', { exact: true });
  await tutor.getByRole('button', { name: 'Show a worked example', exact: true }).click();
  await expect(input).toHaveValue('Walk me through an example from this lesson.');
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await expect(page.locator('main > [role="alert"]')).toBeVisible();
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('Walk me through an example from this lesson.');
  await expect(tutor.getByRole('button', { name: 'Explain simply', exact: true })).toBeDisabled();
  expect((await readSession()).conversation).toEqual([]);
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await expect(
    tutor.getByRole('list', { name: 'Course tutor conversation' }).locator(':scope > li'),
  ).toHaveCount(2);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect((await readSession()).conversation).toHaveLength(2);
});

function uncertainTutorStream() {
  return (
    'event: token\ndata: {"text":"Interrupted answer"}\n\n' +
    'event: error\ndata: ' +
    JSON.stringify({
      error: {
        code: 'internal',
        message: 'Tutor stream ended before completion; retry with a new request',
        details: { reason: 'operation_uncertain' },
      },
    }) +
    '\n\n'
  );
}

test('course tutor checks saved state before a new explicit attempt after interruption', async ({ page }) => {
  const { tutor, readSession } = await openTutor(page);
  const before = await readSession();
  const ids: string[] = [];
  await page.route('**/api/course-enrollments/*/tutor/stream', async (route) => {
    ids.push(CourseChatRequestSchema.parse(route.request().postDataJSON()).id);
    if (ids.length === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: uncertainTutorStream(),
      });
    } else {
      await route.continue();
    }
  });
  const input = tutor.getByLabel('Your question', { exact: true });
  await tutor.getByRole('button', { name: 'Explain simply', exact: true }).click();
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await expect(page.locator('main > [role="alert"]')).toContainText(
    'The interrupted response was not saved.',
  );
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('Explain this lesson in simpler terms.');
  expect(await readSession()).toEqual(before);
  expect(ids).toHaveLength(1);
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await expect(
    tutor.getByRole('list', { name: 'Course tutor conversation' }).locator(':scope > li'),
  ).toHaveCount(2);
  expect(ids).toHaveLength(2);
  expect(ids[1]).not.toBe(ids[0]);
  expect((await readSession()).conversation).toHaveLength(2);
});

test('course tutor retains the old request key if checking saved state fails', async ({ page }) => {
  const { tutor } = await openTutor(page);
  const enrollment = new URL(page.url()).searchParams.get('enrollment');
  const ids: string[] = [];
  let checked = 0;
  await page.route(`**/api/course-enrollments/${enrollment}`, async (route) => {
    checked += 1;
    if (checked === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Saved state unavailable' } }),
      });
    } else {
      await route.continue();
    }
  });
  await page.route('**/api/course-enrollments/*/tutor/stream', async (route) => {
    ids.push(CourseChatRequestSchema.parse(route.request().postDataJSON()).id);
    if (ids.length <= 2) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: uncertainTutorStream(),
      });
    } else {
      await route.continue();
    }
  });
  await tutor.getByRole('button', { name: 'Explain simply', exact: true }).click();
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await expect(page.locator('main > [role="alert"]')).toContainText(
    'Could not check the saved conversation: Saved state unavailable',
  );
  await expect(tutor.getByRole('button', { name: 'Ask tutor', exact: true })).toBeEnabled();
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await expect(page.locator('main > [role="alert"]')).toContainText(
    'The interrupted response was not saved.',
  );
  await expect(tutor.getByRole('button', { name: 'Ask tutor', exact: true })).toBeEnabled();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  expect(checked).toBe(2);
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await expect(
    tutor.getByRole('list', { name: 'Course tutor conversation' }).locator(':scope > li'),
  ).toHaveCount(2);
  expect(ids[2]).not.toBe(ids[0]);
});

test('course tutor restores an already saved answer without another generation attempt', async ({ page }) => {
  const { tutor, readSession } = await openTutor(page);
  let requests = 0;
  await page.route('**/api/course-enrollments/*/tutor/stream', async (route) => {
    requests += 1;
    const saved = await route.fetch();
    expect(saved.ok()).toBe(true);
    expect(await saved.text()).toContain('event: done');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: uncertainTutorStream(),
    });
  });
  await tutor.getByRole('button', { name: 'Explain simply', exact: true }).click();
  await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your tutor answer was already saved.');
  await expect(tutor.getByLabel('Your question', { exact: true })).toHaveValue('');
  await expect(
    tutor.getByRole('list', { name: 'Course tutor conversation' }).locator(':scope > li'),
  ).toHaveCount(2);
  await expect(page.locator('main > [role="alert"]')).toHaveCount(0);
  expect((await readSession()).conversation).toHaveLength(2);
  expect(requests).toBe(1);
});

test('course tutor stop preserves the question and saved progress', async ({ page }) => {
  const { tutor, readSession } = await openTutor(page);
  const before = await readSession();
  let releaseRequest: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route('**/api/course-enrollments/*/tutor/stream', async (route) => {
    await released;
    await route.abort('aborted');
  });
  try {
    const input = tutor.getByLabel('Your question', { exact: true });
    await tutor.getByRole('button', { name: 'Explain simply', exact: true }).click();
    await tutor.getByRole('button', { name: 'Ask tutor', exact: true }).click();
    await expect(input).toBeDisabled();
    await expect(tutor.getByRole('button', { name: 'Explain simply', exact: true })).toBeDisabled();
    await tutor.getByRole('button', { name: 'Stop response', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Tutor response cancelled');
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('Explain this lesson in simpler terms.');
    expect(await readSession()).toEqual(before);
  } finally {
    releaseRequest();
  }
});

test('course tutor suggestions respect the fresh independent checkpoint gate', async ({ page }) => {
  const { tutor, readSession } = await openTutor(page);
  await page.getByRole('button', { name: 'Independent checkpoint', exact: true }).click();
  await checkAnswer(page, -1);
  await expect(page.getByLabel('Your answer', { exact: true })).toHaveValue('');
  await checkAnswer(page, -1);
  await expect(page.getByLabel('Your answer', { exact: true })).toHaveValue('');
  expect((await readSession()).remediation?.step).toBe('bridge');
  await checkAnswer(page, 13);
  expect((await readSession()).remediation?.step).toBe('checkpoint');
  await expect(
    tutor.getByText('Tutor questions resume after you finish the fresh checkpoint on your own.'),
  ).toBeVisible();
  await expect(tutor.getByRole('button', { name: 'Explain simply', exact: true })).toBeDisabled();
  await expect(tutor.getByRole('button', { name: 'Show a worked example', exact: true })).toBeDisabled();
  await expect(tutor.getByLabel('Your question', { exact: true })).toBeDisabled();
  await expect(tutor.getByRole('button', { name: 'Ask tutor', exact: true })).toBeDisabled();
});

test('course narration auto-continue pauses at checkpoints and can be interrupted', async ({ page }) => {
  await routeLearningServiceToFixture(page);
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
    .filter({ has: page.getByRole('heading', { name: 'Python Foundations', exact: true }) });
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
