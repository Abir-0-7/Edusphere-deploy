import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const docId = '41a51eb0-25f0-41e7-a748-ea5448e0a6c2';
const now = '2026-11-19T00:00:00Z';

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: '1d1fa606-a18a-4b46-8dc6-6fd6ea866edb',
    revision: 1,
    created_at: now,
    updated_at: now,
    kind: 'book_chapter',
    title: 'Chapter with a missing date',
    authors: [],
    issued: null,
    container_title: '',
    edition: '',
    volume: '',
    issue: '',
    item_pages: '',
    publisher: '',
    doi: '',
    url: '',
    isbn: '',
    accessed: null,
    repository_commit: '',
    source_document_id: null,
    metadata_provenance: [],
    metadata_suggestions: [],
    ...overrides,
  };
}

async function installApi(page: Page, initial: Record<string, unknown>[] = []) {
  const items = [...initial];
  const mutations: Array<{ method: string; body: Record<string, unknown> | null }> = [];
  await page.route('**/api/bibliography**', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/library-documents')) {
      await route.fulfill({
        json: {
          documents: [{ id: docId, title: 'Algorithms source PDF' }],
          limit: 100,
          offset: 0,
          total_count: 1,
        },
      });
      return;
    }
    if (route.request().method() === 'GET' && url.pathname.endsWith('/api/bibliography')) {
      await route.fulfill({ json: { items, limit: 100, offset: 0, total_count: items.length } });
      return;
    }
    const body: Record<string, unknown> | null =
      route.request().method() === 'DELETE'
        ? null
        : (route.request().postDataJSON() as Record<string, unknown>);
    mutations.push({ method: route.request().method(), body });
    if (route.request().method() === 'POST') {
      const saved = record({
        ...body,
        id: '1d1fa606-a18a-4b46-8dc6-6fd6ea866edb',
        revision: 1,
        created_at: now,
        updated_at: now,
      });
      items.push(saved);
      await route.fulfill({ status: 201, json: saved });
      return;
    }
    if (route.request().method() === 'PUT') {
      const index = items.findIndex((item) => item.id === url.pathname.split('/').at(-1));
      if (index < 0) throw new Error('Expected an existing bibliography record.');
      const prior = items[index]!;
      const cleanBody = Object.fromEntries(
        Object.entries(body ?? {}).filter(([key]) => key !== 'expected_revision'),
      );
      const saved = record({ ...prior, ...cleanBody, revision: Number(prior.revision) + 1, updated_at: now });
      items[index] = saved;
      await route.fulfill({ json: saved });
      return;
    }
    if (route.request().method() === 'DELETE') {
      items.splice(0, items.length, ...items.filter((item) => !url.pathname.endsWith(String(item.id))));
      await route.fulfill({ json: { id: url.pathname.split('/').at(-1), deleted: true } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Not found' } } });
  });
  return mutations;
}

test('saves multiple authors, an explicit page range and an owned-library link while leaving the date missing', async ({
  page,
}) => {
  const mutations = await installApi(page);
  await page.goto('/');
  const workspace = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Bibliography library' }) });
  await expect(workspace.getByRole('heading', { name: 'Bibliography library' })).toBeVisible();
  await workspace.getByLabel('Source type').selectOption('book_chapter');
  await workspace.getByLabel('Title', { exact: true }).fill('Reliable Search Structures');
  await workspace.getByRole('button', { name: 'Add author' }).click();
  await workspace.getByLabel('Given name').fill('Ada');
  await workspace.getByLabel('Family name').fill('Lovelace');
  await workspace.getByLabel('Page range').fill('12-28');
  await workspace.getByLabel('Link an owned study document (optional)').selectOption(docId);
  await workspace.getByRole('button', { name: 'Save reference' }).click();

  await expect(workspace.getByRole('button', { name: /Reliable Search Structures/ })).toBeVisible();
  const created = mutations.find(({ method }) => method === 'POST')?.body;
  expect(created).toMatchObject({
    kind: 'book_chapter',
    title: 'Reliable Search Structures',
    authors: [{ given: 'Ada', family: 'Lovelace' }],
    issued: null,
    item_pages: '12-28',
    source_document_id: docId,
  });
});

test('keeps a conflicting date suggestion unconfirmed until explicit review and uses optimistic revision', async ({
  page,
}) => {
  const initial = record({
    id: '1d1fa606-a18a-4b46-8dc6-6fd6ea866edb',
    title: 'A referenced paper',
    issued: { year: 2020 },
    authors: [{ family: 'Lovelace', given: 'Ada' }],
    metadata_provenance: [{ field: 'issued', source: 'manual', confirmed: true }],
  });
  const mutations = await installApi(page, [initial]);
  await page.goto('/');
  const workspace = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Bibliography library' }) });
  await workspace.getByRole('button', { name: /A referenced paper/ }).click();
  await workspace.getByLabel('Field').selectOption('issued');
  await workspace.getByLabel('Suggestion source').selectOption('doi');
  await workspace.getByLabel('Unconfirmed value').fill('2021');
  await workspace.getByRole('button', { name: 'Add', exact: true }).click();
  await workspace.getByRole('button', { name: 'Save changes' }).click();

  const firstUpdate = mutations.find(({ method }) => method === 'PUT')?.body;
  expect(firstUpdate).toMatchObject({
    expected_revision: 1,
    issued: { year: 2020 },
    metadata_suggestions: [{ field: 'issued', value: '2021', source: 'doi' }],
  });
  await workspace.getByRole('button', { name: /Apply for review/ }).click();
  await workspace.getByRole('button', { name: 'Save changes' }).click();
  const updates = mutations.filter(({ method }) => method === 'PUT');
  expect(updates[1]?.body).toMatchObject({
    expected_revision: 2,
    issued: { literal: '2021' },
    metadata_suggestions: [],
    metadata_provenance: expect.arrayContaining([
      { field: 'issued', source: 'doi', confirmed: true },
      { field: 'title', source: 'manual', confirmed: true },
      { field: 'authors', source: 'manual', confirmed: true },
    ]),
  });
});

test('formats selected citations in the chosen style and downloads CSL exports', async ({ page }) => {
  const saved = record({
    kind: 'book',
    title: 'Algorithms in Plain English',
    authors: [{ family: 'Lovelace', given: 'Ada' }],
    issued: { year: 1843 },
    item_pages: '12-28',
    publisher: 'Example Press',
    doi: '10.1234/example',
    isbn: '9780306406157',
  });
  const earlier = record({
    id: '7d85a99f-e2c7-41a6-bda5-43b6006b452f',
    title: 'Computing Machinery',
    authors: [{ family: 'Hopper', given: 'Grace' }],
    issued: { year: 1936 },
    doi: '',
    isbn: '',
  });
  await installApi(page, [earlier, saved]);
  await page.goto('/');
  const workspace = page.locator('#bibliography-workspace');
  await workspace.getByLabel('Cited reference').selectOption(String(saved.id));
  await workspace.getByLabel('Page / section locator').fill('14');
  await workspace.getByRole('button', { name: 'Format APA / MLA / IEEE' }).click();
  await expect(workspace.getByText('(Lovelace, 1843, p. 14)')).toBeVisible();
  await expect(workspace.getByText(/Lovelace, A\. \(1843\).*Example Press/)).toBeVisible();

  await workspace.getByLabel('Style').selectOption('mla');
  await workspace.getByRole('button', { name: 'Format APA / MLA / IEEE' }).click();
  await expect(workspace.getByText('(Lovelace 14)')).toBeVisible();
  await workspace.getByLabel('Style').selectOption('ieee');
  await workspace.getByRole('button', { name: 'Format APA / MLA / IEEE' }).click();
  await expect(workspace.getByText('[2, p. 14]')).toBeVisible();

  const download = page.waitForEvent('download');
  await workspace.getByRole('button', { name: 'Export RIS' }).click();
  expect((await download).suggestedFilename()).toBe('studyvault-bibliography.ris');
  await expect(workspace.getByRole('link', { name: 'citeproc 2.4.63 source' })).toHaveAttribute(
    'href',
    '/licenses/citeproc-2.4.63.js',
  );
});

test('previews RIS import duplicates, keeps missing metadata blank, and saves only after review', async ({
  page,
}) => {
  const existing = record({
    kind: 'book',
    title: 'Algorithms in Plain English',
    authors: [{ family: 'Lovelace', given: 'Ada' }],
    issued: null,
    isbn: '9780306406157',
    doi: '',
  });
  const mutations = await installApi(page, [existing]);
  await page.goto('/');
  const workspace = page.locator('#bibliography-workspace');
  const ris =
    'TY  - BOOK\nTI  - Algorithms in Plain English\nAU  - Lovelace, Ada\nSN  - 0-306-40615-2\nER  -';
  await workspace.getByLabel('Import format').selectOption('ris');
  await workspace.getByLabel('Citation records').fill(ris);
  await workspace.getByRole('button', { name: 'Parse and preview' }).click();
  const preview = workspace.getByRole('list', { name: 'Imported reference previews' });
  await expect(preview.getByText('Possible duplicate by isbn')).toBeVisible();
  await expect(preview.getByText('No date')).toBeVisible();
  await preview.getByRole('button', { name: 'Review duplicate' }).click();
  expect(mutations).toHaveLength(0);
  await workspace.getByLabel('Title', { exact: true }).fill('Manual title override');
  await workspace.getByRole('button', { name: 'Save changes' }).click();
  await expect(workspace.getByText('Saved revision 2.')).toBeVisible();
  expect(mutations.find(({ method }) => method === 'PUT')?.body).toMatchObject({
    expected_revision: 1,
    title: 'Manual title override',
    issued: null,
    isbn: '9780306406157',
    metadata_provenance: expect.arrayContaining([
      { field: 'isbn', source: 'ris', confirmed: true },
      { field: 'title', source: 'manual', confirmed: true },
    ]),
  });
});
