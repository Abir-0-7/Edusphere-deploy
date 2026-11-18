import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  GameCommandInputSchema,
  GameCreateInputSchema,
  GameIdSchema,
  type GameId,
  type GameSnapshot,
  type GameSession,
} from '@studyvault/types';
import {
  applyGame,
  createGame,
  getGameResult,
  getPublicQuestion,
  restoreGame,
  serializeGame,
} from '../../game-engine/src/session';
import { questionsFor } from '../../game-engine/src/content';
import { readCyberverseMessage } from '../src/lib/cyberverse-client';

function viewFor(snapshot: GameSnapshot): GameSession['view'] {
  const state = restoreGame(snapshot);
  const result = getGameResult(state);
  return {
    values: state.values,
    columns: state.columns,
    towers: state.towers,
    question: getPublicQuestion(state),
    feedback: state.feedback,
    correct: state.correct,
    mistakes: state.mistakes,
    hints: state.hints,
    score: result.score,
    explanation: result.explanation,
  };
}

type Input = 'pointer' | 'keyboard' | 'touch';
type CyberverseStateFixture = {
  mode: 'production';
  student: { id: string; displayName: string };
  tokens: number;
  xp: number;
  unlocked: string[];
  completed: string[];
  achievements: string[];
};

const cyberverseInitial: CyberverseStateFixture = {
  mode: 'production',
  student: { id: 'fixture-learner', displayName: 'Learner' },
  tokens: 10,
  xp: 0,
  unlocked: [],
  completed: [],
  achievements: [],
};
const TITLES: Record<GameId, string> = {
  SortingRace: 'Sorting Race',
  NQueens: 'N-Queens',
  TowersOfHanoi: 'Towers of Hanoi',
  FlashcardTowerDefense: 'Recall Defense',
  ConceptMatch: 'Concept Match',
  RetrievalSprint: 'Retrieval Sprint',
  CodeTrace: 'Code Trace',
};
function gamePath(id: GameId): string {
  return `/games/${id
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()}`;
}

async function fixtureServer(page: Page) {
  const sessions = new Map<string, GameSession>();
  let active: GameSession | undefined;
  let counter = 0;
  let awardedTokens = 0;
  let failDelete = false;
  let unavailableBalance = false;
  let cyberverseState = structuredClone(cyberverseInitial);
  let failCyberverseContext = false;
  const cyberverseCalls: Array<{ operation: string; body: Record<string, unknown> | null }> = [];
  await page.route('**/api/tokens/balance', async (route) => {
    if (unavailableBalance) {
      unavailableBalance = false;
      await route.fulfill({
        status: 503,
        json: { error: { code: 'internal', message: 'Balance unavailable' } },
      });
    } else await route.fulfill({ json: { balance: 23 + awardedTokens } });
  });
  await page.route('**/api/game-vault/**', async (route) => {
    const url = new URL(route.request().url());
    const operation = url.pathname.split('/').at(-1) ?? '';
    const body =
      route.request().method() === 'POST'
        ? (route.request().postDataJSON() as Record<string, unknown>)
        : null;
    cyberverseCalls.push({ operation, body });
    if (operation === 'context' && failCyberverseContext) {
      failCyberverseContext = false;
      await route.fulfill({
        status: 503,
        json: { error: { code: 'internal', message: 'Balance unavailable' } },
      });
      return;
    }
    if (operation === 'unlock' && body?.missionId === 'binary_city') {
      if (!cyberverseState.unlocked.includes('binary_city')) {
        if (cyberverseState.tokens < 5) {
          await route.fulfill({
            status: 409,
            json: {
              error: {
                code: 'invalid_input',
                message: 'Binary City needs 5 StudyVault tokens for its one-time unlock.',
              },
            },
          });
          return;
        }
        cyberverseState = {
          ...cyberverseState,
          tokens: cyberverseState.tokens - 5,
          unlocked: [...cyberverseState.unlocked, 'binary_city'],
        };
      }
    }
    if (operation === 'progress' && body?.missionId === 'binary_city') {
      const evidence = body.evidence as { challengeVersion?: unknown; answers?: unknown } | undefined;
      const expected = [1, 2, 0, 3, 2, 0];
      const evidenceKeys =
        evidence && typeof evidence === 'object' ? Object.keys(evidence).sort().join('|') : '';
      const answers = evidence?.answers;
      if (
        evidenceKeys !== 'answers|challengeVersion' ||
        evidence?.challengeVersion !== 'binary-v1' ||
        !Array.isArray(answers) ||
        answers.length !== expected.length ||
        !expected.every((answer, index) => answers[index] === answer)
      ) {
        await route.fulfill({
          status: 422,
          json: {
            error: { code: 'invalid_input', message: 'The Binary City completion could not be verified.' },
          },
        });
        return;
      }
      cyberverseState = {
        ...cyberverseState,
        xp: cyberverseState.completed.includes('binary_city') ? cyberverseState.xp : cyberverseState.xp + 100,
        completed: [...new Set([...cyberverseState.completed, 'binary_city'])],
      };
    }
    await route.fulfill({ json: { ok: true, state: cyberverseState } });
  });
  await page.route('**/api/games/sessions**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const id = path.split('/')[4];
    if (request.method() === 'GET') {
      if (id) {
        const found = sessions.get(id);
        await route.fulfill({
          status: found ? 200 : 404,
          json: found ?? { error: { message: 'session not found' } },
        });
      } else {
        const progression = Object.fromEntries(
          GameIdSchema.options.map((game) => [
            game,
            [...sessions.values()].filter(
              (session) => session.snapshot.config.game_id === game && session.status === 'won',
            ).length,
          ]),
        );
        await route.fulfill({ json: { sessions: [...sessions.values()].reverse(), progression } });
      }
      return;
    }
    if (request.method() === 'DELETE') {
      if (failDelete) {
        failDelete = false;
        await route.fulfill({ status: 503, json: { error: { message: 'delete unavailable' } } });
        return;
      }
      sessions.delete(id!);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (!id) {
      if (sessions.size >= 100) {
        await route.fulfill({
          status: 429,
          json: { error: { message: 'saved game limit reached (100 sessions)' } },
        });
        return;
      }
      const input = GameCreateInputSchema.parse(request.postDataJSON());
      counter++;
      const snapshot = serializeGame(createGame({ version: 1, ...input, seed: 17 }));
      active = {
        id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
        revision: 0,
        snapshot,
        status: 'ready',
        tokens_awarded: 0,
        updated_at: new Date().toISOString(),
        view: viewFor(snapshot),
      };
      sessions.set(active.id, active);
      await route.fulfill({ status: 201, json: active });
      return;
    }
    const command = GameCommandInputSchema.parse(request.postDataJSON());
    const stored = sessions.get(id);
    if (!stored || stored.revision !== command.revision) {
      await route.fulfill({ status: 409, json: { error: { message: 'session revision is stale' } } });
      return;
    }
    const next = structuredClone(stored);
    if (command.command === 'start' || command.command === 'resume') next.status = 'playing';
    if (command.command === 'pause') next.status = 'paused';
    if (command.command === 'abandon') next.status = 'abandoned';
    if (command.command === 'act') {
      const state = applyGame(restoreGame(next.snapshot), command.action);
      next.snapshot = serializeGame(state);
      const result = getGameResult(state);
      next.status = result.status;
      if (result.rewardEligible) {
        next.tokens_awarded = Math.min(5, Math.max(1, Math.floor(result.score / 200)));
        awardedTokens += next.tokens_awarded;
      }
    }
    next.view = viewFor(next.snapshot);
    next.revision++;
    next.updated_at = new Date().toISOString();
    sessions.set(id, next);
    active = next;
    await route.fulfill({ json: next });
  });
  return {
    get active() {
      return active;
    },
    sessions,
    get awardedTokens() {
      return awardedTokens;
    },
    failNextDelete() {
      failDelete = true;
    },
    failNextBalance() {
      unavailableBalance = true;
    },
    fillToLimit() {
      if (!active) throw new Error('Create a fixture session first');
      for (let index = sessions.size; index < 100; index++) {
        const id = `99999999-0000-4000-8000-${String(index).padStart(12, '0')}`;
        sessions.set(id, { ...structuredClone(active), id });
      }
    },
    failNextCyberverseContext() {
      failCyberverseContext = true;
    },
    cyberverseCalls,
    get cyberverseState() {
      return cyberverseState;
    },
  };
}

async function activate(page: Page, locator: Locator, input: Input) {
  if (input === 'keyboard') {
    await locator.focus();
    await page.keyboard.press('Enter');
  } else if (input === 'touch') await locator.tap();
  else await locator.click();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

function activePanel(page: Page) {
  return page.locator('section[aria-labelledby="active-game-heading"]');
}

async function begin(page: Page, id: GameId, input: Input) {
  const path = gamePath(id);
  if (!page.url().endsWith(path)) await page.goto(path);
  const newGame = page.getByRole('button', { name: `New ${TITLES[id]}`, exact: true });
  await expect(newGame).toBeEnabled();
  await expect(page.getByText(/^Study tokens: \d+$/)).toBeVisible();
  await activate(page, newGame, input);
  await expect(activePanel(page).getByText('ready', { exact: true })).toBeVisible();
  await activate(page, activePanel(page).getByRole('button', { name: 'Start', exact: true }), input);
}

async function finish(
  page: Page,
  server: Awaited<ReturnType<typeof fixtureServer>>,
  input: Input,
  correct = true,
) {
  const panel = activePanel(page);
  const current = server.active;
  if (!current) throw new Error('No fixture session');
  if (current.snapshot.config.game_id === 'SortingRace') {
    while (server.active?.status === 'playing') {
      const values = restoreGame(server.active.snapshot).values;
      const target = [...values].sort((a, b) => a - b);
      const left = values.findIndex((value, index) => value !== target[index]);
      if (left < 0) break;
      const right = values.findIndex((value, index) => index > left && value === target[left]);
      await activate(page, panel.getByRole('button', { name: new RegExp(`^Position ${left + 1}:`) }), input);
      await activate(page, panel.getByRole('button', { name: new RegExp(`^Position ${right + 1}:`) }), input);
    }
  } else if (current.snapshot.config.game_id === 'NQueens') {
    for (const [row, column] of [1, 3, 0, 2].entries()) {
      await activate(
        page,
        panel.getByRole('button', { name: `Row ${row + 1}, column ${column + 1}`, exact: true }),
        input,
      );
    }
  } else if (current.snapshot.config.game_id === 'TowersOfHanoi') {
    const moves: Array<[number, number]> = [];
    const solve = (count: number, from: number, to: number, spare: number): void => {
      if (!count) return;
      solve(count - 1, from, spare, to);
      moves.push([from, to]);
      solve(count - 1, spare, to, from);
    };
    solve(3, 0, 2, 1);
    for (const [from, to] of moves) {
      await activate(page, panel.getByRole('button', { name: new RegExp(`^Peg ${from + 1},`) }), input);
      await activate(page, panel.getByRole('button', { name: new RegExp(`^Peg ${to + 1},`) }), input);
    }
  } else {
    while (server.active?.status === 'playing') {
      const state = restoreGame(server.active.snapshot);
      const question = getPublicQuestion(state);
      const privateQuestion = questionsFor(state.config)[state.questionIndex];
      if (!question || !privateQuestion) break;
      const choice = correct
        ? privateQuestion.answer
        : (privateQuestion.answer + 1) % question.choices.length;
      const answer = question.choices[choice];
      if (!answer) throw new Error('Missing fixture answer');
      await activate(page, panel.getByRole('button', { name: answer, exact: true }), input);
      await expect(panel.getByRole('link', { name: /^Read source:/ })).toHaveAttribute(
        'href',
        /^https:\/\/docs\.python\.org\//,
      );
    }
  }
  await expect(panel.getByText(correct ? 'won' : 'lost', { exact: true })).toBeVisible();
}

test.use({ hasTouch: true });

test('the player never downloads grading rules or authored answer keys', async ({ page }) => {
  await fixtureServer(page);
  const modules: Array<{ url: string; text: string }> = [];
  const pending: Promise<void>[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'script') return;
    pending.push(
      response.text().then((text) => {
        modules.push({ url: response.url(), text });
      }),
    );
  });
  await page.goto(gamePath('ConceptMatch'));
  await expect(page.getByRole('status').filter({ hasText: 'Study tokens:' })).toHaveText('Study tokens: 23');
  await expect(page.getByRole('heading', { name: 'Concept Match', level: 1 })).toBeVisible();
  await Promise.all(pending);
  expect(modules.length).toBeGreaterThan(0);
  for (const module of modules) {
    expect(module.url).not.toMatch(/game-engine.*(?:content|session|vault-view)/);
    for (const secret of ['concept-list', 'trace-add', 'AUTHORED_QUESTIONS', 'answer is out of order']) {
      expect(module.text, module.url).not.toContain(secret);
    }
  }
});

test('question focus scopes only the approved authored objective', async ({ page }) => {
  const server = await fixtureServer(page);
  await page.goto(gamePath('ConceptMatch'));
  await page.getByLabel('Question focus').selectOption('python.collections');
  await page.getByRole('button', { name: 'New Concept Match', exact: true }).click();
  expect(server.active?.snapshot.config.objective_id).toBe('python.collections');
  await activate(page, activePanel(page).getByRole('button', { name: 'Start', exact: true }), 'keyboard');
  const approved = questionsFor(server.active!.snapshot.config);
  expect(approved.length).toBeGreaterThan(0);
  expect(approved.every((question) => question.objective_id === 'python.collections')).toBe(true);
  await finish(page, server, 'keyboard');
});

test('a wrong answer loses a one-question objective set instead of awarding a win', async ({ page }) => {
  const server = await fixtureServer(page);
  await page.goto(gamePath('ConceptMatch'));
  await page.getByLabel('Question focus').selectOption('python.branching');
  await page.getByRole('button', { name: 'New Concept Match', exact: true }).click();
  await expect(activePanel(page).getByText(/at least 60% correct/)).toBeVisible();
  await activate(page, activePanel(page).getByRole('button', { name: 'Start', exact: true }), 'keyboard');
  expect(questionsFor(server.active!.snapshot.config)).toHaveLength(1);
  await finish(page, server, 'keyboard', false);
  expect(server.active?.tokens_awarded).toBe(0);
});

for (const [input, width] of [
  ['pointer', 1440],
  ['keyboard', 768],
  ['touch', 390],
] as const) {
  test(`all seven games complete with ${input} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const server = await fixtureServer(page);
    for (const id of GameIdSchema.options) {
      await begin(page, id, input);
      await finish(page, server, input);
      await expect(activePanel(page).getByText(/token\(s\) awarded by the server/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}

test('question games show loss, explanation and source, then retry without losing resume or preferences', async ({
  page,
}) => {
  const server = await fixtureServer(page);
  await page.goto(gamePath('ConceptMatch'));
  await page.getByLabel('Sound feedback').uncheck();
  await page.getByLabel('Reduce motion').check();
  for (const id of ['ConceptMatch', 'RetrievalSprint', 'CodeTrace'] as const) {
    await begin(page, id, 'keyboard');
    await finish(page, server, 'keyboard', false);
    await expect(activePanel(page).getByText(/token\(s\) awarded by the server/)).toHaveCount(0);
    await activate(page, activePanel(page).getByRole('button', { name: 'Retry as new session' }), 'keyboard');
    await expect(activePanel(page).getByText('ready', { exact: true })).toBeVisible();
    await activate(page, activePanel(page).getByRole('button', { name: 'Start', exact: true }), 'keyboard');
    await activate(page, activePanel(page).getByRole('button', { name: 'Pause', exact: true }), 'keyboard');
    const savedId = server.active?.id;
    await page.reload();
    await expect(page.getByLabel('Sound feedback')).not.toBeChecked();
    await expect(page.getByLabel('Reduce motion')).toBeChecked();
    await activate(
      page,
      page
        .getByRole('region', { name: 'Saved sessions' })
        .getByRole('button', { name: 'Resume', exact: true })
        .first(),
      'keyboard',
    );
    await activate(page, activePanel(page).getByRole('button', { name: 'Resume', exact: true }), 'keyboard');
    expect(server.active?.id).toBe(savedId);
    await finish(page, server, 'keyboard');
  }
});

test('practice supports legal undo and hints without a scheduling reward', async ({ page }) => {
  const server = await fixtureServer(page);
  await page.goto(gamePath('TowersOfHanoi'));
  await page.getByLabel(/Practice mode/).check();
  await begin(page, 'TowersOfHanoi', 'pointer');
  const panel = activePanel(page);
  await activate(page, panel.getByRole('button', { name: /^Peg 1,/ }), 'pointer');
  await activate(page, panel.getByRole('button', { name: /^Peg 3,/ }), 'pointer');
  await activate(page, panel.getByRole('button', { name: 'Undo', exact: true }), 'pointer');
  expect(restoreGame(server.active!.snapshot).towers[2]).toEqual([]);
  await activate(page, panel.getByRole('button', { name: 'Hint', exact: true }), 'pointer');
  await expect(panel.getByText(/^Hint:/)).toBeVisible();
  await finish(page, server, 'pointer');
  expect(server.active?.tokens_awarded).toBe(0);
});

test('hard puzzle boards remain fully reachable after resize and restore', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const server = await fixtureServer(page);
  await page.goto(gamePath('NQueens'));
  await page.getByLabel('Difficulty').selectOption('hard');
  await begin(page, 'NQueens', 'touch');
  const panel = activePanel(page);
  await expect(panel.getByRole('button', { name: /^Row \d+, column \d+/ })).toHaveCount(64);
  await activate(page, panel.getByRole('button', { name: 'Row 8, column 8', exact: true }), 'touch');
  expect(restoreGame(server.active!.snapshot).columns[7]).toBe(7);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(panel.getByRole('button', { name: 'Row 8, column 8, queen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('deleting an old save frees capacity for a new session', async ({ page }) => {
  const server = await fixtureServer(page);
  await page.goto('/games/sorting-race');
  await begin(page, 'SortingRace', 'pointer');
  server.fillToLimit();
  await page.getByRole('button', { name: 'Refresh sessions' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(100);
  await page.getByRole('button', { name: 'New Sorting Race', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('saved game limit reached');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete saved game', exact: true }).first().click();
  await expect(page.getByRole('listitem')).toHaveCount(99);
  await page.getByRole('button', { name: 'New Sorting Race', exact: true }).click();
  await expect(activePanel(page).getByText('ready', { exact: true })).toBeVisible();
  expect(server.sessions.size).toBe(100);
});

test('saved sessions delete only after server success and preserve already-awarded tokens', async ({
  page,
}) => {
  const server = await fixtureServer(page);
  await page.goto('/');
  await begin(page, 'ConceptMatch', 'pointer');
  await finish(page, server, 'pointer');
  expect(server.awardedTokens).toBeGreaterThan(0);
  await expect(page.getByRole('status').filter({ hasText: 'Study tokens:' })).toHaveText(
    `Study tokens: ${23 + server.awardedTokens}`,
  );
  const sessionId = server.active?.id;
  const saved = page.getByRole('region', { name: 'Saved sessions' }).getByRole('listitem');
  server.failNextDelete();
  page.once('dialog', (dialog) => void dialog.accept());
  await saved.getByRole('button', { name: 'Delete saved game' }).click();
  await expect(page.getByRole('alert')).toContainText('delete unavailable');
  await expect(saved).toBeVisible();
  expect(server.awardedTokens).toBeGreaterThan(0);

  page.once('dialog', (dialog) => void dialog.accept());
  await saved.getByRole('button', { name: 'Delete saved game' }).click();
  await expect(page.getByText('No saved sessions for Concept Match yet.')).toBeVisible();
  expect(server.sessions.has(sessionId ?? '')).toBe(false);
  expect(server.awardedTokens).toBeGreaterThan(0);
  await expect(activePanel(page)).toHaveCount(0);
});

test('the game menu opens distinct pages with scoped saves and direct URLs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtureServer(page);
  await page.goto('/games');
  await expect(page.getByRole('heading', { name: 'Game Vault', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Cyberverse', exact: true })).toHaveAttribute(
    'href',
    '/games/cyberverse',
  );
  await page.locator('summary', { hasText: 'Games' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Games menu' })
      .getByRole('link', { name: 'Cyberverse', exact: true }),
  ).toHaveAttribute('href', '/games/cyberverse');
  await page.locator('summary', { hasText: 'Games' }).click();
  for (const id of GameIdSchema.options) {
    await expect(page.getByRole('link', { name: `Open ${TITLES[id]}`, exact: true })).toHaveAttribute(
      'href',
      gamePath(id),
    );
  }
  await page.getByRole('link', { name: 'Open Sorting Race' }).tap();
  await expect(page).toHaveURL(/\/games\/sorting-race$/);
  await begin(page, 'SortingRace', 'keyboard');
  await page.getByRole('link', { name: 'All games', exact: true }).click();
  await page.getByRole('link', { name: 'Open N-Queens' }).click();
  await expect(page).toHaveURL(/\/games\/n-queens$/);
  await expect(page.getByRole('heading', { name: 'N-Queens', level: 1 })).toBeVisible();
  await expect(page.getByText('No saved sessions for N-Queens yet.')).toBeVisible();
  await expect(activePanel(page)).toHaveCount(0);
  await page.goto(gamePath('SortingRace'));
  await expect(page.getByRole('region', { name: 'Saved sessions' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(activePanel(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the shared persisted token balance reloads after a reward and recovers from unavailable', async ({
  page,
}) => {
  const server = await fixtureServer(page);
  await page.goto('/games');
  await expect(page.getByRole('status').filter({ hasText: 'Study tokens:' })).toHaveText('Study tokens: 23');
  await begin(page, 'ConceptMatch', 'pointer');
  await finish(page, server, 'pointer');
  await expect(page.getByRole('status').filter({ hasText: 'Study tokens:' })).toHaveText(
    `Study tokens: ${23 + server.awardedTokens}`,
  );
  server.failNextBalance();
  await page.getByRole('link', { name: 'All games', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Study tokens:' })).toHaveText(
    'Study tokens: Unavailable',
  );
  await page.getByRole('button', { name: 'Retry token balance', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Study tokens:' })).toHaveText(
    `Study tokens: ${23 + server.awardedTokens}`,
  );
});

test('Cyberverse waits for account context, loads verified Godot assets, and accepts only its same-origin iframe bridge', async ({
  page,
}) => {
  const server = await fixtureServer(page);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.route('**/games/cyberverse/index.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `
      class Engine {
        static getMissingFeatures() { return []; }
        startGame() {
          void Promise.all([fetch('index.wasm', { method: 'HEAD' }), fetch('index.pck', { method: 'HEAD' })]);
          setTimeout(() => {
            window.CyberverseEduSphereBridge.install(() => {});
            window.CyberverseEduSphereBridge.send_json(JSON.stringify({channel:'edusphere.game-vault',version:1,gameId:'cyberverse',type:'EDUSPHERE_GAME_READY',requestId:'',payload:{}}));
          }, 0);
          return Promise.resolve();
        }
      }
    `,
    }),
  );
  server.failNextCyberverseContext();
  await page.goto('/games/cyberverse');
  await expect(page.getByText('Study tokens: Unavailable')).toBeVisible();
  await expect(page.locator('iframe[title="Cyberverse interactive game"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
  await expect(page.getByText(/Demo mode|sample tokens|practice fallback/i)).toHaveCount(0);

  await page.getByRole('button', { name: 'Retry connection' }).click();
  const iframe = page.locator('iframe[title="Cyberverse interactive game"]');
  await expect(iframe).toHaveAttribute('src', '/games/cyberverse/index.html');
  await expect(page.getByText('Study tokens: 10')).toBeVisible();
  await expect.poll(() => requested.some((url) => url.endsWith('/games/cyberverse/index.js'))).toBe(true);
  await expect.poll(() => requested.some((url) => url.endsWith('/games/cyberverse/index.wasm'))).toBe(true);
  await expect.poll(() => requested.some((url) => url.endsWith('/games/cyberverse/index.pck'))).toBe(true);

  const child = page.frames().find((frame) => frame.url().includes('/games/cyberverse/index.html'));
  if (!child) throw new Error('Cyberverse frame did not load');
  const fakeRequest = {
    channel: 'edusphere.game-vault',
    version: 1,
    gameId: 'cyberverse',
    type: 'EDUSPHERE_UNLOCK_MISSION_REQUEST',
    requestId: 'parent-forgery',
    payload: { missionId: 'binary_city' },
  };
  await page.evaluate((message) => window.postMessage(message, window.location.origin), fakeRequest);
  await expect
    .poll(() => server.cyberverseCalls.filter((call) => call.operation === 'unlock').length)
    .toBe(0);

  await child.evaluate(
    (origin) =>
      window.parent.postMessage(
        {
          channel: 'edusphere.game-vault',
          version: 1,
          gameId: 'cyberverse',
          type: 'EDUSPHERE_UNLOCK_MISSION_REQUEST',
          requestId: 'binary-unlock-1',
          payload: { missionId: 'binary_city' },
        },
        origin,
      ),
    new URL(page.url()).origin,
  );
  await expect(page.getByText('Binary City is unlocked')).toBeVisible();
  await expect(page.getByText('Study tokens: 5')).toBeVisible();
  expect(server.cyberverseCalls.filter((call) => call.operation === 'unlock')).toHaveLength(1);
  expect(server.cyberverseCalls.find((call) => call.operation === 'unlock')?.body).toMatchObject({
    gameId: 'cyberverse',
    missionId: 'binary_city',
    requestId: 'binary-unlock-1',
  });

  await child.evaluate(
    (origin) =>
      window.parent.postMessage(
        {
          channel: 'edusphere.game-vault',
          version: 1,
          gameId: 'cyberverse',
          type: 'EDUSPHERE_UNLOCK_MISSION_REQUEST',
          requestId: 'binary-unlock-replay',
          payload: { missionId: 'binary_city' },
        },
        origin,
      ),
    new URL(page.url()).origin,
  );
  await expect(page.getByText('Binary City unlocked. Replays are free.')).toBeVisible();
  await expect(page.getByText('Study tokens: 5')).toBeVisible();
  expect(server.cyberverseCalls.filter((call) => call.operation === 'unlock')).toHaveLength(2);

  await child.evaluate(
    (origin) =>
      window.parent.postMessage(
        {
          channel: 'edusphere.game-vault',
          version: 1,
          gameId: 'cyberverse',
          type: 'EDUSPHERE_MISSION_PROGRESS',
          requestId: 'binary-progress-1',
          payload: {
            missionId: 'binary_city',
            completed: true,
            xp: 99999,
            evidence: { challengeVersion: 'binary-v1', answers: [1, 0, 2, 1, 3, 0] },
          },
        },
        origin,
      ),
    new URL(page.url()).origin,
  );
  await expect(page.getByText('The Binary City completion could not be verified.')).toBeVisible();
  await expect(page.getByText('Game XP: 0')).toBeVisible();

  await child.evaluate(
    (origin) =>
      window.parent.postMessage(
        {
          channel: 'edusphere.game-vault',
          version: 1,
          gameId: 'cyberverse',
          type: 'EDUSPHERE_MISSION_PROGRESS',
          requestId: 'binary-progress-valid',
          payload: {
            missionId: 'binary_city',
            completed: true,
            xp: 99999,
            evidence: { challengeVersion: 'binary-v1', answers: [1, 2, 0, 3, 2, 0] },
          },
        },
        origin,
      ),
    new URL(page.url()).origin,
  );
  await expect(page.getByText('Mission progress saved.')).toBeVisible();
  await expect(page.getByText('Game XP: 100')).toBeVisible();
  await child.evaluate(
    (origin) =>
      window.parent.postMessage(
        {
          channel: 'edusphere.game-vault',
          version: 1,
          gameId: 'cyberverse',
          type: 'EDUSPHERE_MISSION_PROGRESS',
          requestId: 'binary-progress-replay',
          payload: {
            missionId: 'binary_city',
            completed: true,
            xp: 99999,
            evidence: { challengeVersion: 'binary-v1', answers: [1, 2, 0, 3, 2, 0] },
          },
        },
        origin,
      ),
    new URL(page.url()).origin,
  );
  await expect(page.getByText('Game XP: 100')).toBeVisible();
  expect(server.cyberverseState.xp).toBe(100);
  await expect
    .poll(() => server.cyberverseCalls.filter((call) => call.operation === 'progress').length)
    .toBe(3);
  expect(server.cyberverseCalls.find((call) => call.operation === 'progress')?.body).toMatchObject({
    gameId: 'cyberverse',
    missionId: 'binary_city',
    evidence: { challengeVersion: 'binary-v1' },
  });
});

test('the committed Godot Web export starts in Chromium', async ({ page }) => {
  const server = await fixtureServer(page);
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/games/cyberverse');
  await expect(page.getByText('Study tokens: 10')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Cyberverse is ready.', { timeout: 120_000 });
  for (const asset of ['index.js', 'index.wasm', 'index.pck']) {
    expect(requested.some((url) => url.endsWith(`/games/cyberverse/${asset}`))).toBe(true);
  }
  expect(server.cyberverseCalls.some((call) => call.operation === 'context')).toBe(true);
});

test('Cyberverse bridge rejects wrong-origin and parent-source requests', () => {
  const iframeWindow = {} as Window;
  const parentWindow = {} as Window;
  const origin = 'http://127.0.0.1:4317';
  const message = {
    channel: 'edusphere.game-vault',
    version: 1,
    gameId: 'cyberverse',
    type: 'EDUSPHERE_UNLOCK_MISSION_REQUEST',
    requestId: 'bridge-check',
    payload: { missionId: 'binary_city' },
  };
  expect(
    readCyberverseMessage(
      { source: iframeWindow, origin: 'http://attacker.invalid', data: message },
      iframeWindow,
      origin,
    ),
  ).toBeNull();
  expect(
    readCyberverseMessage({ source: parentWindow, origin, data: message }, iframeWindow, origin),
  ).toBeNull();
  expect(
    readCyberverseMessage({ source: iframeWindow, origin, data: message }, iframeWindow, origin),
  ).not.toBeNull();
});
