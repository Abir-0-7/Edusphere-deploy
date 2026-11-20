import { expect, test } from '@playwright/test';
import type { ConceptGraph, ConceptGraphNodeActions, ConceptGraphRecord } from '@studyvault/types';
import { readFile } from 'node:fs/promises';

function fixture(): ConceptGraph {
  const nodes: ConceptGraph['nodes'] = [
    { id: 'root', label: 'Document root full label', kind: 'root', objective_id: null, evidence_ids: [] },
  ];
  const edges: ConceptGraph['edges'] = [];
  for (let branch = 0; branch < 5; branch += 1) {
    nodes.push({
      id: `branch-${branch}`,
      label: `Chapter branch ${branch}`,
      kind: 'chapter',
      objective_id: null,
      evidence_ids: [],
    });
    edges.push({
      id: `root-${branch}`,
      source: 'root',
      target: `branch-${branch}`,
      relation: 'contains',
      evidence_ids: [],
    });
    for (let leaf = 0; leaf < (branch === 4 ? 8 : 9); leaf += 1) {
      const id = `leaf-${branch}-${leaf}`;
      nodes.push({
        id,
        label: `Complete searchable label ${branch}-${leaf} for a source concept`,
        kind: 'concept',
        objective_id: null,
        evidence_ids: [],
      });
      edges.push({
        id: `link-${branch}-${leaf}`,
        source: `branch-${branch}`,
        target: id,
        relation: 'contains',
        evidence_ids: [],
      });
    }
  }
  edges.push({
    id: 'related-cross',
    source: 'leaf-0-0',
    target: 'leaf-4-7',
    relation: 'related',
    evidence_ids: [],
  });
  return { version: 1, nodes, edges, evidence: [], annotations: {}, layout: {} };
}

function graphRecord(
  documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  label = 'Available source graph',
): ConceptGraphRecord {
  const graph = fixture();
  graph.nodes[0] = { ...graph.nodes[0]!, label };
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    document_id: documentId,
    revision: 4,
    graph,
    created_at: '2026-11-19T00:00:00Z',
    updated_at: '2026-11-19T00:00:00Z',
  };
}

test('a stalled graph response body reaches a retryable deadline and aborts its request', async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    let stalled = false;
    window.fetch = (input, init) => {
      if (!stalled && String(input).endsWith('/concept-graph')) {
        stalled = true;
        document.documentElement.dataset.mapStarted = 'yes';
        init?.signal?.addEventListener('abort', () => {
          document.documentElement.dataset.mapAborted = 'yes';
        });
        return Promise.resolve(
          new Response(new ReadableStream(), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return fetch(input, init);
    };
  });
  await page.route('**/api/documents/*/concept-graph', (route) => route.fulfill({ json: graphRecord() }));
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Loading concept graph…');
  await expect(page.locator('html')).toHaveAttribute('data-map-started', 'yes');

  await page.clock.fastForward(45_001);

  await expect(page.getByRole('alert')).toContainText('taking too long');
  await expect(page.locator('html')).toHaveAttribute('data-map-aborted', 'yes');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved concept graph' })).toContainText(
    'Available source graph',
  );
});

test('changing sources aborts the old map load and ignores its late response', async ({ page }) => {
  const previous = graphRecord(undefined, 'Previous source private label');
  const current = graphRecord('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Current source graph');
  await page.addInitScript((oldRecord) => {
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).includes('/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/concept-graph')) {
        document.documentElement.dataset.oldMapStarted = 'yes';
        init?.signal?.addEventListener('abort', () => {
          document.documentElement.dataset.oldMapAborted = 'yes';
        });
        return new Promise<Response>((resolve) => {
          window.addEventListener(
            'resolve-old-map',
            () =>
              resolve(
                new Response(JSON.stringify(oldRecord), {
                  headers: { 'content-type': 'application/json' },
                }),
              ),
            { once: true },
          );
        });
      }
      return fetch(input, init);
    };
  }, previous);
  await page.route('**/api/documents/cccccccc-cccc-4ccc-8ccc-cccccccccccc/concept-graph', (route) =>
    route.fulfill({ json: current }),
  );
  await page.goto('/?switch_source=1');
  await expect(page.getByRole('status')).toHaveText('Loading concept graph…');
  await expect(page.locator('html')).toHaveAttribute('data-old-map-started', 'yes');
  await page.getByRole('button', { name: 'Switch source', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved concept graph' })).toContainText(
    'Current source graph',
  );
  await expect(page.locator('html')).toHaveAttribute('data-old-map-aborted', 'yes');

  await page.evaluate(() => window.dispatchEvent(new Event('resolve-old-map')));

  await expect(page.getByRole('region', { name: 'Saved concept graph' })).toContainText(
    'Current source graph',
  );
  await expect(page.getByText('Previous source private label', { exact: true })).toHaveCount(0);
});

test('forbidden saved graphs show the service error without starting generation', async ({ page }) => {
  let generations = 0;
  await page.route('**/api/documents/*/mindmap', async (route) => {
    generations += 1;
    await route.abort();
  });
  await page.route('**/api/documents/*/concept-graph', (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: 'unauthorized', message: 'This source is not available to this account.' } },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('This source is not available to this account.');
  expect(generations).toBe(0);
});

test('50-node explorer supports branch navigation, edits, undo, saved layout and every export', async ({
  page,
}, testInfo) => {
  let saved: ConceptGraphRecord = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    revision: 4,
    graph: fixture(),
    created_at: '2026-11-19T00:00:00Z',
    updated_at: '2026-11-19T00:00:00Z',
  };
  const labels = saved.graph.nodes.map((node) => node.label);
  let saves = 0;
  await page.route('**/api/documents/*/concept-graph/nodes/*/actions?revision=*', async (route) => {
    const path = new URL(route.request().url());
    await route.fulfill({
      json: {
        graph_revision: Number(path.searchParams.get('revision')),
        node_id: decodeURIComponent(path.pathname.split('/').at(-2)!),
        source: null,
        lesson: null,
        deck: null,
        board: null,
      },
    });
  });
  await page.route('**/api/documents/*/concept-graph', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { graph: ConceptGraph; expected_revision: number };
      expect(body.expected_revision).toBe(saved.revision);
      saved = { ...saved, graph: body.graph, revision: saved.revision + 1 };
      saves += 1;
    }
    await route.fulfill({ json: saved });
  });
  await page.goto('/');
  const explorer = page.getByRole('region', { name: 'Saved concept graph' });
  const outline = explorer.getByRole('list', { name: 'Concept graph keyboard outline' });
  await expect(explorer).toContainText('Keyboard outline (50 nodes)');
  await expect(outline.getByRole('button', { name: labels[10]!, exact: true })).toBeVisible();
  await outline.getByRole('button', { name: 'Collapse Chapter branch 0', exact: true }).click();
  await expect(
    outline.getByRole('button', { name: 'Complete searchable label 0-0 for a source concept', exact: true }),
  ).toHaveCount(0);
  await explorer.getByRole('textbox', { name: 'Search graph labels' }).fill('Complete searchable label 0-0');
  await expect(
    outline.getByRole('button', { name: 'Complete searchable label 0-0 for a source concept', exact: true }),
  ).toBeVisible();
  await explorer.getByRole('textbox', { name: 'Search graph labels' }).fill('');
  await outline.getByRole('button', { name: 'Expand Chapter branch 0', exact: true }).click();
  await outline
    .getByRole('button', { name: 'Complete searchable label 0-0 for a source concept', exact: true })
    .click();
  await explorer.getByRole('textbox', { name: 'Edit selected label' }).fill('Edited concept full label');
  await explorer.getByRole('button', { name: 'Update label' }).click();
  await expect(outline.getByRole('button', { name: 'Edited concept full label', exact: true })).toBeVisible();
  await explorer.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    outline.getByRole('button', { name: 'Complete searchable label 0-0 for a source concept', exact: true }),
  ).toBeVisible();
  await explorer.getByRole('button', { name: 'Move right', exact: true }).click();
  await explorer.getByRole('button', { name: 'Save edits', exact: true }).click();
  await expect(explorer.getByRole('status')).toContainText('revision 5');
  expect(saves).toBe(1);
  expect(saved.graph.layout.positions).toBeTruthy();
  await page.reload();
  await expect(explorer).toContainText('revision 5');
  await page.screenshot({ path: testInfo.outputPath('map-explorer.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await explorer.getByRole('combobox', { name: 'Focus branch', exact: true }).selectOption('branch-0');
  const canvas = explorer.getByRole('group', { name: 'Saved concept graph canvas', exact: true });
  await expect
    .poll(async () => canvas.evaluate((element) => element.parentElement?.scrollLeft ?? 0))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('map-explorer-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  const downloads: Record<string, Buffer> = {};
  for (const format of ['JSON', 'SVG', 'PNG', 'PDF']) {
    const pending = page.waitForEvent('download');
    await explorer.getByRole('button', { name: `Export ${format}`, exact: true }).click();
    const download = await pending;
    const path = testInfo.outputPath(`concept-graph.${format.toLowerCase()}`);
    await download.saveAs(path);
    await testInfo.attach(`concept graph ${format}`, { path });
    downloads[format] = await readFile(path);
  }
  for (const label of labels) {
    expect(downloads.JSON!.toString()).toContain(label);
    expect(downloads.SVG!.toString()).toContain(label);
  }
  expect(downloads.PNG!.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(downloads.PDF!.subarray(0, 5).toString()).toBe('%PDF-');
});

function actions(revision = 4): ConceptGraphNodeActions {
  return {
    graph_revision: revision,
    node_id: 'leaf-0-0',
    source: {
      document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      chapter_id: '11111111-1111-4111-8111-111111111111',
      chunk_id: '22222222-2222-4222-8222-222222222222',
      page: 3,
      quote: 'The selected source explains this exact concept.',
    },
    lesson: {
      enrollment_id: '33333333-3333-4333-8333-333333333333',
      course_slug: 'python-foundations',
      lesson_id: 'variables',
      objective_id: 'python-variables',
      title: 'Pinned variables lesson',
      content: 'The pinned lesson explains **variables** using the selected source.',
    },
    deck: {
      document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      deck_id: '44444444-4444-4444-8444-444444444444',
      card_ids: ['55555555-5555-4555-8555-555555555555'],
    },
    board: {
      document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      node_id: 'leaf-0-0',
      label: 'Selected source concept',
      quote: 'The selected source explains this exact concept.',
      page: 3,
    },
  };
}

test('saved node actions resolve exact source, pinned lesson and deck, preserving annotations on regeneration', async ({
  page,
}) => {
  let saved: ConceptGraphRecord = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    revision: 4,
    graph: fixture(),
    created_at: '2026-11-19T00:00:00Z',
    updated_at: '2026-11-19T00:00:00Z',
  };
  await page.route('**/api/documents/*/concept-graph', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { graph: ConceptGraph; expected_revision: number };
      expect(body.expected_revision).toBe(saved.revision);
      saved = { ...saved, graph: body.graph, revision: saved.revision + 1 };
    }
    await route.fulfill({ json: saved });
  });
  await page.route('**/api/documents/*/concept-graph/nodes/*/actions?revision=*', async (route) => {
    const revision = Number(new URL(route.request().url()).searchParams.get('revision'));
    if (revision !== saved.revision) {
      await route.fulfill({
        status: 409,
        json: { error: { code: 'conflict', message: 'The graph revision changed.' } },
      });
      return;
    }
    await route.fulfill({ json: actions(revision) });
  });
  await page.route('**/api/documents/*/concept-graph/regenerate', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ expected_revision: saved.revision });
    expect(saved.graph.annotations['leaf-0-0']).toBe('My durable note for this source.');
    expect(saved.graph.layout.positions).toBeTruthy();
    saved = { ...saved, revision: saved.revision + 1 };
    await route.fulfill({ json: saved });
  });
  await page.goto('/');
  const explorer = page.getByRole('region', { name: 'Saved concept graph', exact: true });
  await explorer
    .getByRole('list', { name: 'Concept graph keyboard outline' })
    .getByRole('button', { name: 'Complete searchable label 0-0 for a source concept', exact: true })
    .click();
  const learning = explorer.getByRole('region', { name: 'Selected concept learning actions' });
  await expect(learning.getByRole('link', { name: 'Open source' })).toHaveAttribute(
    'href',
    /graph_action=source/,
  );
  await expect(learning.getByRole('link', { name: 'Open deck' })).toHaveAttribute(
    'href',
    /graph_action=deck/,
  );
  await expect(learning.getByRole('link', { name: 'Practice this concept' })).toHaveAttribute(
    'href',
    /graph_action=practice/,
  );
  await expect(learning.getByRole('link', { name: 'Add to board' })).toHaveAttribute(
    'href',
    /source_document=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/,
  );
  await learning.getByRole('button', { name: 'Open lesson' }).click();
  await expect(learning.getByRole('article', { name: 'Linked lesson preview' })).toContainText(
    'Pinned variables lesson',
  );
  await expect(learning.getByRole('link', { name: 'Continue course' })).toHaveAttribute(
    'href',
    '/courses/python-foundations?enrollment=33333333-3333-4333-8333-333333333333',
  );
  await explorer
    .getByRole('textbox', { name: 'Selected node annotation' })
    .fill('My durable note for this source.');
  await explorer.getByRole('button', { name: 'Update annotation' }).click();
  await expect(explorer.getByRole('button', { name: 'Regenerate from source' })).toBeDisabled();
  await explorer.getByRole('button', { name: 'Move right', exact: true }).click();
  await explorer.getByRole('button', { name: 'Save edits', exact: true }).click();
  await expect(explorer.getByRole('status')).toContainText('revision 5');
  await explorer.getByRole('button', { name: 'Regenerate from source' }).click();
  await expect(explorer.getByRole('status')).toContainText('Regenerated graph revision 7');
  await expect(explorer.getByRole('textbox', { name: 'Selected node annotation' })).toHaveValue(
    'My durable note for this source.',
  );
  await page.reload();
  await explorer
    .getByRole('list', { name: 'Concept graph keyboard outline' })
    .getByRole('button', { name: 'Complete searchable label 0-0 for a source concept', exact: true })
    .click();
  await expect(explorer.getByRole('textbox', { name: 'Selected node annotation' })).toHaveValue(
    'My durable note for this source.',
  );
});

test('board handoff previews and rechecks the exact source before explicit insertion', async ({ page }) => {
  let resolutions = 0;
  await page.route('**/api/documents/*/concept-graph/nodes/*/actions?revision=*', async (route) => {
    resolutions += 1;
    await route.fulfill({ json: actions() });
  });
  await page.goto('/?board_preview=1');
  const preview = page.getByRole('region', { name: 'Concept board insertion preview' });
  const board = page.getByRole('list', { name: 'Existing local board shapes' });
  await expect(preview).toContainText('The selected source explains this exact concept.');
  await expect(board.getByRole('listitem')).toHaveCount(1);
  await preview.getByRole('button', { name: 'Insert concept into board' }).click();
  await expect(board.getByRole('listitem')).toHaveCount(2);
  await expect(board).toContainText('Existing board shape');
  await expect(board).toContainText('Selected source concept');
  await expect(preview.getByRole('button', { name: 'Added to board' })).toBeDisabled();
  expect(resolutions).toBe(2);
});

test('board insertion leaves existing shapes intact when the source becomes stale', async ({ page }) => {
  let resolutions = 0;
  await page.route('**/api/documents/*/concept-graph/nodes/*/actions?revision=*', async (route) => {
    resolutions += 1;
    if (resolutions === 1) {
      await route.fulfill({ json: actions() });
    } else {
      await route.fulfill({
        status: 409,
        json: { error: { code: 'conflict', message: 'The source or graph changed. Reload it first.' } },
      });
    }
  });
  await page.goto('/?board_preview=1');
  const preview = page.getByRole('region', { name: 'Concept board insertion preview' });
  await expect(preview).toContainText('The selected source explains this exact concept.');
  await preview.getByRole('button', { name: 'Insert concept into board' }).click();
  await expect(preview.getByRole('alert')).toContainText('source or graph changed');
  await expect(
    page.getByRole('list', { name: 'Existing local board shapes' }).getByRole('listitem'),
  ).toHaveCount(1);
});

test('document handoff re-resolves source and practices only approved concept cards without scheduling reviews', async ({
  page,
}) => {
  const resolved = actions();
  const docId = resolved.source!.document_id;
  const deckId = resolved.deck!.deck_id;
  const requestedDecks: (string | null)[] = [];
  let reviewRequests = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/review')) {
      reviewRequests += 1;
      await route.fulfill({ status: 500, body: 'Unexpected scheduled review' });
    } else if (url.pathname.endsWith('/chapters')) {
      await route.fulfill({
        json: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            title: 'Other chapter',
            ordinal: 1,
            start_page: 1,
            end_page: 2,
          },
          {
            id: resolved.source!.chapter_id,
            title: 'Exact supporting chapter',
            ordinal: 2,
            start_page: 3,
            end_page: 5,
          },
        ],
      });
    } else if (url.pathname.endsWith('/flashcard-studio/decks')) {
      await route.fulfill({
        json: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            name: 'Default deck',
            is_default: true,
            card_count: 1,
          },
          { id: deckId, name: 'Exact concept deck', is_default: false, card_count: 2 },
        ],
      });
    } else if (url.pathname.endsWith('/flashcards')) {
      requestedDecks.push(url.searchParams.get('deck_id'));
      const card = {
        id: resolved.deck!.card_ids[0],
        front: 'Approved concept question',
        back: 'Approved concept answer',
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 0,
        due_date: '2026-11-19',
        document_id: docId,
        chapter_id: resolved.source!.chapter_id,
        source_chunk_id: resolved.source!.chunk_id,
        tags: [],
        status: 'active',
        needs_review: false,
      };
      await route.fulfill({
        json: [card, { ...card, id: '88888888-8888-4888-8888-888888888888', front: 'Other deck question' }],
      });
    } else if (url.pathname.includes('/concept-graph/nodes/')) {
      const nodeId = decodeURIComponent(url.pathname.split('/').at(-2)!);
      await route.fulfill({
        json:
          nodeId === resolved.node_id
            ? resolved
            : {
                graph_revision: 4,
                node_id: nodeId,
                source: null,
                lesson: null,
                deck: null,
                board: null,
              },
      });
    } else if (url.pathname.endsWith('/concept-graph')) {
      await route.fulfill({
        json: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          document_id: docId,
          revision: 4,
          graph: fixture(),
          created_at: '2026-11-19T00:00:00Z',
          updated_at: '2026-11-19T00:00:00Z',
        },
      });
    } else {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'unavailable', message: 'Isolated fixture: unrelated action unavailable.' } },
      });
    }
  });
  await page.goto(`/document/${docId}?graph_node=leaf-0-0&graph_revision=4&graph_action=practice`);
  await expect(page.getByRole('region', { name: 'Linked concept source' })).toContainText(
    resolved.source!.quote,
  );
  await expect(page.getByRole('button', { name: /Exact supporting chapter/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const viewer = page.getByRole('region', { name: 'Flashcard viewer' });
  await expect(viewer).toContainText('Approved concept question');
  await expect(viewer).not.toContainText('Other deck question');
  await expect(viewer).toContainText('1 / 1');
  await expect(page.getByRole('combobox', { name: 'Saved deck filter' })).toHaveValue(deckId);
  await viewer.getByRole('button', { name: 'Reveal answer' }).click();
  await viewer.getByRole('button', { name: 'Mark missed' }).click();
  await viewer.getByRole('button', { name: 'Practice missed (1)' }).click();
  await viewer.getByRole('button', { name: 'Got it' }).click();
  await expect(viewer).toContainText('You cleared every missed card.');
  expect(requestedDecks).toContain(deckId);
  expect(reviewRequests).toBe(0);
});
