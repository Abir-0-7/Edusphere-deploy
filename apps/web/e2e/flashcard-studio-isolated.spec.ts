import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const chapterOne = '11111111-1111-4111-8111-111111111111';
const chapterTwo = '22222222-2222-4222-8222-222222222222';
const draftId = '33333333-3333-4333-8333-333333333333';
const createdDeckId = '88888888-8888-4888-8888-888888888888';
const cards = [
  {
    id: '44444444-4444-4444-8444-444444444444',
    chapter_id: chapterOne,
    source_chunk_id: '55555555-5555-4555-8555-555555555555',
    source_quote: 'A selected source fact appears here.',
    front: 'What fact appears in chapter one?',
    back: 'A selected source fact appears here.',
    page: 1,
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    chapter_id: chapterTwo,
    source_chunk_id: '77777777-7777-4777-8777-777777777777',
    source_quote: 'A second selected source fact appears here.',
    front: 'What fact appears in chapter two?',
    back: 'A second selected source fact appears here.',
    page: null,
  },
];

function routes(page: Page, targetedRegeneration = false) {
  const merges: unknown[] = [];
  const reviewRequests: string[] = [];
  const reportRequests: unknown[] = [];
  const handler = async (route: import('@playwright/test').Route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/decks')) {
      const decks = [{ id: draftId, name: 'Default deck', is_default: true, card_count: 2 }];
      await route.fulfill({
        json: merges.length
          ? [...decks, { id: createdDeckId, name: 'Exam prep', is_default: false, card_count: 1 }]
          : decks,
      });
    } else if (pathname.endsWith('/drafts') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        chapter_ids: string[];
        topic: string | null;
        count: number;
      };
      expect(body.chapter_ids).toEqual(targetedRegeneration ? [chapterOne] : [chapterOne, chapterTwo]);
      if (body.topic) expect(body.topic).toBe('Cell structure');
      expect(body.count).toBe(targetedRegeneration ? 1 : 2);
      await route.fulfill({ json: { job_id: draftId, draft_id: draftId } });
    } else if (pathname.endsWith('/drafts') && route.request().method() === 'GET') {
      throw new Error('An unexpected bare draft request was made.');
    } else if (pathname.endsWith('/merge')) {
      const body = route.request().postDataJSON() as {
        card_ids: string[];
        deck_name?: string;
        replacements?: Array<{ draft_card_id: string; card_id: string }>;
      };
      merges.push(body);
      await route.fulfill({
        json: targetedRegeneration
          ? { deck_id: draftId, added_count: 0, updated_count: 1 }
          : { deck_id: createdDeckId, added_count: 1, updated_count: 0 },
      });
    } else if (pathname.endsWith(`/drafts/${draftId}`)) {
      await route.fulfill({
        json: {
          id: draftId,
          source_revision: 'a'.repeat(64),
          settings: {
            chapter_ids: targetedRegeneration ? [chapterOne] : [chapterOne, chapterTwo],
            topic: targetedRegeneration ? null : 'Cell structure',
            language: 'en',
            difficulty: 'basic',
            count: targetedRegeneration ? 1 : 2,
          },
          cards: targetedRegeneration ? [cards[0]!] : cards,
          merge_result: null,
        },
      });
    } else {
      await route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Not found' } } });
    }
  };
  return Promise.all([
    page.route('**/api/documents/**/flashcard-studio/**', handler),
    page.route('**/api/flashcards/*/explain', async (route) => {
      await route.fulfill({
        json: {
          card_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          available: true,
          explanation: "This explanation uses the card's supporting source.",
          source_quote: 'The source evidence for the first card.',
          source_excerpt: 'The source evidence for the first card.',
          page: 7,
        },
      });
    }),
    page.route('**/api/flashcards/*/review', async (route) => {
      reviewRequests.push(route.request().url());
      await route.fulfill({
        status: 500,
        json: { error: { code: 'internal', message: 'Unexpected scheduled review.' } },
      });
    }),
    page.route('**/api/flashcards/*/report', async (route) => {
      reportRequests.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          card_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          report_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          status: 'received',
        },
      });
    }),
    page.route(`**/api/jobs/${draftId}`, async (route) => {
      await route.fulfill({ json: { id: draftId, kind: 'flashcard_studio', status: 'done', attempts: 1 } });
    }),
  ]).then(() => ({ merges, reviewRequests, reportRequests }));
}

test('previews evidence and merges only selected cards into the named deck', async ({ page }) => {
  const { merges } = await routes(page);
  await page.goto('/');
  const studio = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Flashcard Studio test fixture' }) });
  const chapters = studio.getByRole('group', { name: 'Chapters from this source' });

  await expect(chapters.getByLabel('Chapter one')).toBeChecked();
  await chapters.getByLabel('Chapter two').check();
  await studio.getByLabel('Topic (optional)').fill('Cell structure');
  await studio.getByLabel('Maximum cards').fill('2');
  await studio.getByRole('button', { name: 'Review settings' }).click();
  await expect(studio.getByLabel('Draft settings')).toContainText('Generation uses your AI quota');
  await studio.getByRole('button', { name: 'Generate draft' }).click();
  await expect(studio.getByRole('group', { name: 'Preview draft cards' })).toBeVisible();
  await studio.getByText('Source evidence', { exact: false }).first().click();
  await expect(studio.locator('blockquote').first()).toBeVisible();

  await studio.getByRole('checkbox').nth(1).uncheck();
  await studio.getByLabel('Saved deck filter and save destination').selectOption('__new__');
  await studio.getByLabel('New deck name').fill('Exam prep');
  await studio.getByRole('button', { name: 'Save 1 selected card' }).click();
  await expect(studio.getByRole('status')).toContainText('Added 1 and updated 0 card(s)');
  expect(merges).toEqual([{ card_ids: [cards[0]!.id], deck_name: 'Exam prep', replacements: [] }]);
  await expect(page.getByTestId('selected-deck')).toHaveText(createdDeckId);
  await expect(page.getByTestId('saved-deck')).toHaveText(createdDeckId);
});

test('keeps the draft when no card is selected and requires explicit save', async ({ page }) => {
  const { merges } = await routes(page);
  await page.goto('/');
  const studio = page.locator('main');
  await studio.getByLabel('Chapter two').check();
  await studio.getByLabel('Maximum cards').fill('2');
  await studio.getByRole('button', { name: 'Review settings' }).click();
  await studio.getByRole('button', { name: 'Generate draft' }).click();
  await expect(studio.getByText(cards[0]!.front)).toBeVisible();
  const previewChecks = studio.getByRole('group', { name: 'Preview draft cards' }).getByRole('checkbox');
  await previewChecks.nth(0).uncheck();
  await previewChecks.nth(1).uncheck();
  await expect(studio.getByRole('button', { name: 'Save 0 selected cards' })).toBeDisabled();
  await expect(studio.getByRole('button', { name: 'Discard preview' })).toBeVisible();
  await expect(studio.getByRole('status')).toContainText('Draft ready');
  expect(merges).toHaveLength(0);
});

test('explains a quota-deferred draft and opens the completed preview on the next poll', async ({ page }) => {
  await page.clock.install();
  await routes(page);
  let polls = 0;
  await page.route(`**/api/jobs/${draftId}`, (route) => {
    polls += 1;
    return route.fulfill({
      json: {
        id: draftId,
        kind: 'flashcard_studio',
        status: polls === 1 ? 'pending' : 'done',
        attempts: 0,
        error_reason: polls === 1 ? 'AI usage limit reached; waiting for the next window' : null,
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Chapter two').check();
  await page.getByLabel('Maximum cards').fill('2');
  await page.getByRole('button', { name: 'Review settings' }).click();
  await page.getByRole('button', { name: 'Generate draft' }).click();
  await expect(page.getByRole('status')).toContainText('Draft waiting to retry: AI usage limit reached');
  await page.clock.fastForward(1501);
  await expect(page.getByRole('group', { name: 'Preview draft cards' })).toBeVisible();
});

test('a stalled draft poll reaches a recoverable deadline and Check draft resumes the existing job', async ({
  page,
}) => {
  await page.clock.install();
  await routes(page);
  let polls = 0;
  let release: (() => void) | undefined;
  await page.route(`**/api/jobs/${draftId}`, async (route) => {
    polls += 1;
    if (polls === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route
      .fulfill({ json: { id: draftId, kind: 'flashcard_studio', status: 'done', attempts: 1 } })
      .catch(() => undefined);
  });
  await page.goto('/');
  await page.getByLabel('Chapter two').check();
  await page.getByLabel('Maximum cards').fill('2');
  await page.getByRole('button', { name: 'Review settings' }).click();
  await page.getByRole('button', { name: 'Generate draft' }).click();
  await expect.poll(() => polls).toBe(1);
  await page.clock.fastForward(180_001);
  await expect(page.getByRole('alert')).toContainText('Generation may still be running');
  await page.getByRole('button', { name: 'Check draft', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Preview draft cards' })).toBeVisible();
  expect(polls).toBe(2);
  release?.();
  await expect(page.getByRole('status')).toContainText('Draft ready');
});

test('regenerates a selected saved card and replaces it only after explicit mapping', async ({ page }) => {
  const { merges } = await routes(page, true);
  await page.goto('/');
  const studio = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Flashcard Studio test fixture' }) });
  const targets = studio.getByRole('group', { name: 'Regenerate selected saved cards (optional)' });
  await targets.getByLabel('What did the first source say?').check();
  await expect(studio.getByLabel('Cards to regenerate')).toHaveValue('1');
  await studio.getByRole('button', { name: 'Review settings' }).click();
  await studio.getByRole('button', { name: 'Generate draft' }).click();
  const preview = studio.getByRole('group', { name: 'Preview draft cards' });
  await preview
    .getByLabel('Replace a selected saved card (optional)')
    .selectOption('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await studio.getByRole('button', { name: 'Save 1 selected card' }).click();
  await expect(studio.getByRole('status')).toContainText('Updated 1 selected card');
  expect(merges).toEqual([
    {
      card_ids: [cards[0]!.id],
      replacements: [{ draft_card_id: cards[0]!.id, card_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    },
  ]);
});

test('confirms an incorrect-card report after the server accepts its reason', async ({ page }) => {
  const { reportRequests } = await routes(page);
  page.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept('The answer conflicts with the source quote.');
  });
  await page.goto('/');
  await page
    .getByRole('region', { name: 'Saved card actions' })
    .getByRole('button', { name: 'Report incorrect' })
    .click();
  await expect(page.getByRole('status')).toContainText('Report received.');
  expect(reportRequests).toEqual([{ reason: 'The answer conflicts with the source quote.' }]);
});

test('reveals, resumes, explains and practices missed cards without scheduling reviews', async ({ page }) => {
  const { reviewRequests } = await routes(page);
  await page.goto('/');
  const viewer = page.getByRole('region', { name: 'Flashcard viewer' });

  await expect(viewer.getByText('What did the first source say?')).toBeVisible();
  await expect(viewer.getByText('The first source fact.')).toBeHidden();
  await viewer.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(viewer.getByText('The first source fact.')).toBeVisible();
  await viewer.getByRole('button', { name: 'Explain with source' }).click();
  await expect(viewer.getByText("This explanation uses the card's supporting source.")).toBeVisible();
  await expect(viewer.getByText(/Page 7: The source evidence for the first card\./)).toBeVisible();
  await viewer.getByRole('button', { name: 'Full screen' }).click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await viewer.getByRole('button', { name: 'Mark missed' }).click();
  await expect(viewer.getByRole('button', { name: 'Practice missed (1)' })).toBeEnabled();
  await viewer.getByRole('button', { name: 'Next' }).click();
  await expect(viewer.getByText('What did the second source say?')).toBeVisible();
  await expect(viewer).toContainText('2 / 2');

  await page.reload();
  const resumed = page.getByRole('region', { name: 'Flashcard viewer' });
  await expect(resumed.getByText('What did the second source say?')).toBeVisible();
  await expect(resumed).toContainText('2 / 2');
  await resumed.getByRole('button', { name: 'Practice missed (1)' }).click();
  await expect(resumed.getByText('What did the first source say?')).toBeVisible();
  await resumed.getByRole('button', { name: 'Got it' }).click();
  await expect(resumed.getByText('You cleared every missed card.')).toBeVisible();
  await resumed.getByRole('button', { name: 'Return to all cards' }).click();
  await resumed.getByRole('button', { name: 'Shuffle' }).click();
  await expect(resumed).toContainText('1 / 2');

  const savedKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(
    savedKeys.some(
      (key) => key.includes('viewer-owner') && key.includes('99999999-9999-4999-8999-999999999999'),
    ),
  ).toBe(true);
  expect(reviewRequests).toHaveLength(0);
});

test('shows the source conflict when the original evidence is unavailable', async ({ page }) => {
  await routes(page);
  await page.route('**/api/flashcards/*/explain', async (route) => {
    await route.fulfill({
      status: 409,
      json: { error: { code: 'invalid_input', message: 'Supporting source evidence is unavailable.' } },
    });
  });
  await page.goto('/');
  const viewer = page.getByRole('region', { name: 'Flashcard viewer' });
  await viewer.getByRole('button', { name: 'Explain with source' }).click();
  await expect(viewer.getByRole('alert')).toContainText('Supporting source evidence is unavailable.');
});

test('starts a source-grounded quiz, reveals evidence only after grading, and downloads deck CSV', async ({
  page,
}) => {
  await routes(page);
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const questionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const correctId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const distractorId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await page.route('**/api/documents/*/flashcard-quizzes', async (route) => {
    const body = route.request().postDataJSON() as { deck_id: string; count: number };
    expect(body.deck_id).toBe(draftId);
    expect(body.count).toBe(10);
    await route.fulfill({
      json: {
        id: sessionId,
        document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        deck_id: draftId,
        questions: [
          {
            id: questionId,
            prompt: cards[0]!.front,
            choices: [
              { id: correctId, text: cards[0]!.back },
              { id: distractorId, text: cards[1]!.back },
            ],
          },
        ],
      },
    });
  });
  let submitted: unknown;
  await page.route('**/api/flashcard-quizzes/*/grade', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      json: {
        session_id: sessionId,
        answered: 1,
        correct: 1,
        total: 1,
        percent: 100,
        feedback: [
          {
            question_id: questionId,
            answered: true,
            correct: true,
            source_quote: cards[0]!.source_quote,
            page: 1,
          },
        ],
      },
    });
  });
  await page.route('**/api/documents/*/flashcard-decks/*/export.csv', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: "front,back,source_quote,page,chapter_id,tags\r\n'=SUM(1,1),Safe answer,Source evidence,1,chapter,[]\r\n",
    });
  });

  await page.goto('/');
  const studio = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Flashcard Studio test fixture' }) });
  const actions = studio.getByRole('region', { name: 'Source quiz and CSV export' });
  await actions.getByRole('button', { name: 'Start source quiz' }).click();
  await expect(actions.getByText(cards[0]!.front)).toBeVisible();
  await expect(actions.getByText(/Source \(page 1\):/)).toHaveCount(0);
  await actions.getByLabel(cards[0]!.back).check();
  await actions.getByRole('button', { name: 'Submit quiz' }).click();
  await expect(actions).toContainText('Score: 1 of 1 (100%).');
  await expect(actions).toContainText(cards[0]!.source_quote);
  await expect(actions.getByText(/Source \(page 1\):/)).toBeVisible();
  expect(submitted).toEqual({ answers: [{ question_id: questionId, choice_id: correctId }] });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    actions.getByRole('button', { name: 'Download deck CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^flashcards-Default-deck\.csv$/);
});
