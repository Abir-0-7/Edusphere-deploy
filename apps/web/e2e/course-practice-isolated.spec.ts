import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const publishedCourses = [
  { slug: 'python-foundations', title: 'Python Foundations', problemId: 'python-average' },
  { slug: 'pytorch-fundamentals', title: 'PyTorch Fundamentals', problemId: 'tensor-value-count' },
];

for (const course of publishedCourses) {
  test(`${course.title}: coding lab runs in the bounded practice flow`, async ({ page }) => {
    const runnerRequests: Array<Record<string, unknown>> = [];
    const progressRequests: Array<Record<string, unknown>> = [];
    await page.route('**/api/learning-service/**', async (route) => {
      const upstream = route
        .request()
        .url()
        .replace('http://127.0.0.1:4324/api/learning-service', 'http://127.0.0.1:4325');
      await route.fulfill({ response: await route.fetch({ url: upstream }) });
    });
    await page.addInitScript(
      (id) => localStorage.setItem('fixture-learner', id),
      `published-${randomUUID()}`,
    );
    await page.route('**/api/battles', async (route) => {
      runnerRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          problemId: course.problemId,
          passed: 2,
          total: 2,
          results: [
            { passed: true, output: '12', error: '' },
            { passed: true, output: '10', error: '' },
          ],
          courseReceipt: `${Date.now() + 60_000}.sourcehash.signature`,
        }),
      });
    });
    await page.route('**/api/course-enrollments/*/labs', async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      progressRequests.push(request);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: request.id,
          lab_id: request.lab_id,
          output: 'Accepted after isolated tests.',
          accepted: true,
          progress: 1,
          complete: false,
          revision: Number(request.revision) + 1,
          replayed: false,
        }),
      });
    });

    await page.goto('/courses');
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: course.title }) });
    await card.getByRole('button', { name: 'View course' }).click();
    if (course.slug === 'pytorch-fundamentals') {
      const answers = ['14', 'true', '9', '7', '6'];
      const diagnostic = page.locator('fieldset');
      for (const [index, answer] of answers.entries()) {
        await diagnostic.locator('input').nth(index).fill(answer);
      }
      await diagnostic.getByRole('button', { name: 'Submit and enroll' }).click();
    } else {
      await page.getByRole('button', { name: 'Enroll and begin' }).click();
    }
    await expect(page).toHaveURL(/\?enrollment=/);
    await expect(page.getByRole('heading', { name: /coding lab/i })).toBeVisible();
    const editor = page.locator('.monaco-editor').first();
    await expect(editor).toBeVisible();
    await page.getByRole('combobox', { name: 'Coding language' }).selectOption('javascript');
    await page.getByRole('combobox', { name: 'Coding language' }).selectOption('python');

    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(
      course.slug === 'python-foundations'
        ? 'values = list(map(int, input().split()))\nprint(sum(values) / len(values))'
        : 'rows, columns = map(int, input().split())\nprint(rows * columns)',
    );
    await page.getByRole('button', { name: 'Run tests' }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'All tests passed and the practice task was saved. Try the next task.' }),
    ).toBeVisible();
    await expect(page.getByLabel('Coding test output')).toContainText('Test 2: passed');

    expect(runnerRequests).toHaveLength(1);
    expect(runnerRequests[0]).toMatchObject({
      problemId: course.problemId,
      language: 'python',
      courseContext: { labId: expect.stringContaining(course.slug), taskId: expect.any(String) },
    });
    expect(progressRequests).toHaveLength(1);
    expect(progressRequests[0]).toMatchObject({
      runner_problem_id: course.problemId,
      runner_language: 'python',
      runner_receipt: expect.any(String),
    });
  });
}
