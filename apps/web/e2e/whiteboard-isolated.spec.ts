import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { inspectLocalScreen, keyboardTo } from './helpers/local-accessibility';

const now = '2026-11-20T00:00:00+00:00';
type Board = ReturnType<typeof snapshot>;
function snapshot(title = 'Study board', board_id = randomUUID()) {
  return {
    format: 'studyvault-whiteboard',
    schema_version: 1,
    board_id,
    title,
    revision: 1,
    updated_at: now,
    renderer: { id: 'excalidraw', version: '0.18.1' },
    scene: { elements: [] as Array<Record<string, unknown>>, app_state: {}, file_ids: [] },
  };
}
async function installApi(context: BrowserContext) {
  const boards = new Map<string, Map<string, Board>>();
  const assets = new Map<
    string,
    {
      manifest: {
        id: string;
        file_id: string;
        mime_type: string;
        size_bytes: number;
        sha256: string;
        created_at: string;
      };
      data: Buffer;
    }[]
  >();
  const mutations: Array<{ owner: string; method: string; body: Record<string, unknown> }> = [];
  const previews: Array<{
    owner: string;
    id: string;
    revision: number;
    shape_ids: string[];
    action: string;
    question?: string;
  }> = [];
  const state = { failSave: false, delaySave: false };
  const releases: Array<() => void> = [];
  await context.route('**/api/whiteboards**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const owner = request.headers().authorization ?? '';
    const owned = boards.get(owner) ?? new Map<string, Board>();
    boards.set(owner, owned);
    const id = url.pathname.split('/')[3];
    const assetKey = owner + ':' + id;
    if (url.pathname.endsWith('/learning-preview')) {
      const body = request.postDataJSON() as Omit<(typeof previews)[number], 'owner' | 'id'>;
      const board = id ? owned.get(id) : undefined;
      if (!board || body.revision !== board.revision) {
        await route.fulfill({ status: 404 });
        return;
      }
      const excerpts = board.scene.elements
        .filter((shape) => shape.type === 'text' && body.shape_ids.includes(String(shape.id)))
        .map((shape) => ({ id: String(shape.id), text: String(shape.text) }));
      if (!excerpts.length) {
        await route.fulfill({ status: 400 });
        return;
      }
      const excerpt_ids = excerpts.map((excerpt) => excerpt.id);
      previews.push({ owner, id: board.board_id, ...body });
      await route.fulfill({
        json: {
          board_id: board.board_id,
          revision: board.revision,
          action: body.action,
          excerpts,
          answer: body.action === 'tutor' ? 'Conservation applies within the chosen boundary.' : null,
          answer_excerpt_ids: body.action === 'tutor' ? excerpt_ids : [],
          cards:
            body.action === 'cards'
              ? [{ front: 'What defines the system?', back: 'A chosen boundary.', excerpt_ids }]
              : [],
          nodes:
            body.action === 'map'
              ? [
                  { label: 'System boundary', excerpt_ids },
                  { label: 'Energy transfer', excerpt_ids },
                ]
              : [],
        },
      });
      return;
    }
    if (url.pathname.endsWith('/assets')) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as { data_base64: string; file_id: string; mime_type: string };
        const list = assets.get(assetKey) ?? [];
        const data = Buffer.from(body.data_base64, 'base64');
        const item = list.find((asset) => asset.manifest.file_id === body.file_id) ?? {
          manifest: {
            id: randomUUID(),
            file_id: body.file_id,
            mime_type: body.mime_type,
            size_bytes: data.length,
            sha256: createHash('sha256').update(data).digest('hex'),
            created_at: now,
          },
          data,
        };
        if (!list.includes(item)) list.push(item);
        assets.set(assetKey, list);
        await route.fulfill({ status: 201, json: item.manifest });
        return;
      }
      await route.fulfill({ json: { assets: (assets.get(assetKey) ?? []).map((asset) => asset.manifest) } });
      return;
    }
    if (url.pathname.endsWith('/content')) {
      const asset = (assets.get(assetKey) ?? []).find(
        (item) => item.manifest.id === url.pathname.split('/')[5],
      );
      if (!asset) await route.fulfill({ status: 404 });
      else await route.fulfill({ body: asset.data, contentType: asset.manifest.mime_type });
      return;
    }
    if (request.method() === 'GET') {
      if (!id)
        await route.fulfill({
          json: { items: [...owned.values()], limit: 100, offset: 0, total_count: owned.size },
        });
      else if (owned.has(id)) await route.fulfill({ json: owned.get(id) });
      else await route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'missing' } } });
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    mutations.push({ owner, method: request.method(), body });
    if (request.method() === 'POST') {
      const created = snapshot(String(body.title));
      owned.set(created.board_id, created);
      await route.fulfill({ status: 201, json: created });
      return;
    }
    if (!id) {
      await route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'missing' } } });
      return;
    }
    if (state.delaySave) await new Promise<void>((resolve) => releases.push(resolve));
    if (state.failSave) {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'internal', message: 'temporary board outage' } },
      });
      return;
    }
    const current = owned.get(id);
    if (!current) {
      await route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'missing' } } });
      return;
    }
    if (current.revision !== body.expected_revision) {
      await route.fulfill({
        status: 409,
        json: { error: { code: 'conflict', message: 'changed elsewhere' } },
      });
      return;
    }
    const saved = {
      ...current,
      title: String(body.title),
      scene: body.scene as Board['scene'],
      revision: current.revision + 1,
    };
    owned.set(id, saved);
    await route.fulfill({ json: saved });
  });
  return {
    state,
    boards,
    mutations,
    previews,
    release: () => {
      state.delaySave = false;
      releases.splice(0).forEach((resolve) => resolve());
    },
  };
}
const titleInput = (page: Page) => page.locator('#whiteboard').getByLabel('Board title');
const saved = (page: Page) =>
  expect
    .poll(
      async () =>
        (await page.locator('#whiteboard').getByRole('status').textContent()) +
        ' ' +
        (await page.locator('#whiteboard').getByRole('alert').allTextContents()).join(' '),
    )
    .toMatch(/Saved\. Revision/);
async function editAndSave(page: Page, title: string) {
  await titleInput(page).fill(title);
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await saved(page);
}

test('persists a real drawing and named projects across reload and project switching', async ({
  page,
  context,
}) => {
  const api = await installApi(context);
  await page.goto('/');
  await expect(page.locator('[aria-label="Whiteboard canvas"] canvas').first()).toBeVisible();
  const canvas = page.locator('[aria-label="Whiteboard canvas"] canvas').first();
  await page.getByRole('radio', { name: 'Rectangle', exact: true }).locator('..').click();
  await expect(page.getByRole('radio', { name: 'Rectangle', exact: true })).toBeChecked();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 500, bounds.y + 230);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 620, bounds.y + 310, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await editAndSave(page, 'Algorithms board');
  expect(
    api.mutations.some(
      (item) => item.method === 'PUT' && (item.body.scene as { elements: unknown[] }).elements.length > 0,
    ),
  ).toBe(true);
  await page.reload();
  await expect(titleInput(page)).toHaveValue('Algorithms board');
  await page.getByRole('button', { name: 'New board', exact: true }).click();
  await expect(titleInput(page)).toHaveValue('New study board');
  await editAndSave(page, 'Second project');
  await page.getByLabel('Open board').selectOption({ label: 'Algorithms board' });
  await expect(titleInput(page)).toHaveValue('Algorithms board');
});

test('restores unsynced edits after outage and reload, then synchronizes once recovered', async ({
  page,
  context,
}) => {
  const api = await installApi(context);
  await page.goto('/');
  await editAndSave(page, 'Server copy');
  api.state.failSave = true;
  await titleInput(page).fill('Recovered local edits');
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('temporary board outage');
  await page.reload();
  await expect(titleInput(page)).toHaveValue('Recovered local edits');
  api.state.failSave = false;
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(titleInput(page)).toHaveValue('Recovered local edits');
});

test('offline editor remount preserves a draft and reconnect saves its content', async ({
  page,
  context,
}) => {
  const api = await installApi(context);
  await page.goto('/');
  await editAndSave(page, 'Online board');
  await context.setOffline(true);
  await titleInput(page).fill('Offline draft');
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Waiting to sync');
  // Reload recovery is covered above. Reopen the editor while the loaded app shell is offline.
  await page.getByLabel('Fixture account').selectOption('whiteboard-user-b');
  await expect(titleInput(page)).toHaveValue('Study board');
  await page.getByLabel('Fixture account').selectOption('whiteboard-user-a');
  await expect(titleInput(page)).toHaveValue('Offline draft');
  await context.setOffline(false);
  await saved(page);
  expect(
    [...api.boards.values()]
      .flatMap((items) => [...items.values()])
      .some((board) => board.title === 'Offline draft'),
  ).toBe(true);
});

test('two real tabs keep separate drafts and resolve a stale revision through a recovery copy', async ({
  page,
  context,
}) => {
  await installApi(context);
  await page.goto('/');
  await editAndSave(page, 'Shared initial board');
  const popup = page.waitForEvent('popup');
  await page.evaluate(() => {
    window.open('/', '_blank');
  });
  const other = await popup;
  await expect(titleInput(other)).toHaveValue('Shared initial board');
  expect(
    await other.evaluate(() => sessionStorage.getItem('studyvault-board-tab:whiteboard-user-a')),
  ).not.toBe(await page.evaluate(() => sessionStorage.getItem('studyvault-board-tab:whiteboard-user-a')));
  await editAndSave(page, 'Saved in first tab');
  await titleInput(other).fill('Second tab unsynced edits');
  await other.getByRole('button', { name: 'Save now', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Reload latest', exact: true })).toBeVisible();
  await other.reload();
  await expect(titleInput(other)).toHaveValue('Second tab unsynced edits');
  await expect(other.getByRole('button', { name: 'Reload latest', exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(titleInput(other)).toHaveValue('Saved in first tab');
  await other.reload();
  await expect(titleInput(other)).toHaveValue('Saved in first tab');
  await expect(other.getByRole('button', { name: 'Reload latest', exact: true })).toHaveCount(0);
  await other.getByLabel('Open board').selectOption({ label: 'Second tab unsynced edits (recovery copy)' });
  await expect(titleInput(other)).toHaveValue('Second tab unsynced edits (recovery copy)');
});

test('edits made during a delayed save survive its response and subsequent reload', async ({
  page,
  context,
}) => {
  const api = await installApi(context);
  await page.goto('/');
  await editAndSave(page, 'Initial');
  api.state.delaySave = true;
  await titleInput(page).fill('First save');
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await expect.poll(() => api.mutations.filter((item) => item.method === 'PUT').length).toBeGreaterThan(1);
  await titleInput(page).fill('Newer edits while saving');
  api.release();
  await saved(page);
  await expect(titleInput(page)).toHaveValue('Newer edits while saving');
  await expect
    .poll(() => [...api.boards.values()].flatMap((items) => [...items.values()]).map((board) => board.title))
    .toContain('Newer edits while saving');
  await page.reload();
  await expect(titleInput(page)).toHaveValue('Newer edits while saving');
});

test('switching accounts keeps remote boards and offline drafts isolated', async ({ page, context }) => {
  await installApi(context);
  await page.goto('/');
  await editAndSave(page, 'Private account A');
  await page.getByLabel('Fixture account').selectOption('whiteboard-user-b');
  await expect(titleInput(page)).toHaveValue('Study board');
  await expect(page.getByLabel('Open board')).not.toContainText('Private account A');
  await editAndSave(page, 'Private account B');
  await page.getByLabel('Fixture account').selectOption('whiteboard-user-a');
  await expect(titleInput(page)).toHaveValue('Private account A');
  await expect(page.getByLabel('Open board')).not.toContainText('Private account B');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[aria-label="Whiteboard canvas"] canvas').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/whiteboard-390.png', fullPage: true });
});

test('a delayed response from the previous account never changes the new account board', async ({
  page,
  context,
}) => {
  const api = await installApi(context);
  await page.goto('/');
  await editAndSave(page, 'Account A');
  api.state.delaySave = true;
  await titleInput(page).fill('A pending save');
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await expect.poll(() => api.mutations.filter((item) => item.method === 'PUT').length).toBeGreaterThan(1);
  await page.getByLabel('Fixture account').selectOption('whiteboard-user-b');
  await expect(titleInput(page)).toHaveValue('Study board');
  api.release();
  await editAndSave(page, 'Account B');
  expect([...api.boards.get('Bearer whiteboard-user-b')!.values()].map((board) => board.title)).toEqual([
    'Account B',
  ]);
  await expect(titleInput(page)).toHaveValue('Account B');
});

test('keeps edits made while the save response waits for an IndexedDB commit', async ({ page, context }) => {
  const api = await installApi(context);
  await page.goto('/');
  await editAndSave(page, 'Initial committed board');
  api.state.delaySave = true;
  await titleInput(page).fill('Response waiting for device commit');
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await expect.poll(() => api.mutations.filter((item) => item.method === 'PUT').length).toBeGreaterThan(1);
  await page.evaluate(async () => {
    const original = IDBDatabase.prototype.transaction;
    const flags = { release: false };
    Object.assign(window, { whiteboardCommitFlags: flags });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('studyvault-whiteboard-cache-v1');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = original.call(db, ['boards', 'drafts'], 'readwrite');
        const store = transaction.objectStore('boards');
        const keepAlive = () => {
          const query = store.get(['whiteboard-user-a', 'hold-commit']);
          query.onsuccess = () => {
            resolve();
            if (!flags.release) keepAlive();
          };
        };
        transaction.oncomplete = () => db.close();
        keepAlive();
      };
    });
  });
  const response = page.waitForResponse(
    (value) => value.request().method() === 'PUT' && value.url().includes('/api/whiteboards/'),
  );
  api.release();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await titleInput(page).fill('Edits during the device commit');
  await page.evaluate(() => {
    const flags = (window as Window & { whiteboardCommitFlags?: { release: boolean } }).whiteboardCommitFlags;
    if (!flags) throw new Error('Missing device-commit test gate');
    flags.release = true;
  });
  await saved(page);
  await expect
    .poll(() =>
      [...api.boards.values()].flatMap((boards) => [...boards.values()]).map((board) => board.title),
    )
    .toContain('Edits during the device commit');
  await page.reload();
  await expect(titleInput(page)).toHaveValue('Edits during the device commit');
});

test('preserves exact earlier board bytes and never reads an unowned shared board', async ({
  page,
  context,
}) => {
  await installApi(context);
  const raw = '{"document":{"store":{},"schema":{}},"session":{},"recovery":"original bytes"}';
  await page.addInitScript((value) => {
    localStorage.setItem('studyvault:whiteboard:v2:whiteboard-user-a', value);
    localStorage.setItem('studyvault:whiteboard:v1', 'unowned shared legacy data');
  }, raw);
  await page.goto('/');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download earlier board' }).click();
  expect(await readFile((await (await download).path())!, 'utf8')).toBe(raw);
  await page.getByLabel('Fixture account').selectOption('whiteboard-user-b');
  await expect(titleInput(page)).toHaveValue('Study board');
  await expect(page.getByRole('button', { name: 'Download earlier board' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('studyvault:whiteboard:v1'))).toBe(
    'unowned shared legacy data',
  );
});

test('saves an inserted image and recovers authorized bytes from a corrupted device asset cache', async ({
  page,
  context,
}) => {
  const api = await installApi(context);
  // Exercise the standard file-input fallback instead of the browser's native filesystem picker.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showOpenFilePicker');
  });
  await page.goto('/');
  await expect(page.locator('[aria-label="Whiteboard canvas"] canvas').first()).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('radio', { name: 'Insert image', exact: true }).locator('..').click();
  await (
    await chooser
  ).setFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  const bounds = (await page.locator('[aria-label="Whiteboard canvas"] canvas').first().boundingBox())!;
  await page.mouse.click(bounds.x + 500, bounds.y + 250);
  await editAndSave(page, 'Image project');
  expect(
    api.mutations.some(
      (item) => item.method === 'PUT' && (item.body.scene as { file_ids: string[] }).file_ids.length === 1,
    ),
  ).toBe(true);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('studyvault-whiteboard-cache-v1');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('assets', 'readwrite');
        const store = tx.objectStore('assets');
        const rows = store.getAll();
        rows.onsuccess = () => {
          for (const row of rows.result)
            store.put({ ...row, blob: new Blob(['corrupt'], { type: 'image/png' }) });
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  const image = page.waitForResponse(
    (response) => response.url().includes('/assets/') && response.url().endsWith('/content'),
  );
  await page.reload();
  expect((await image).status()).toBe(200);
  await expect(titleInput(page)).toHaveValue('Image project');
  await editAndSave(page, 'Image restored');
  await page.getByText('Download board', { exact: true }).click();
  await page.getByLabel('File format').selectOption('svg');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download file', exact: true }).click();
  const svg = await readFile((await (await downloaded).path())!, 'utf8');
  expect(svg).toMatch(/href="data:image\/png;base64,/);
  expect(svg).not.toMatch(/href="https?:/);
});

async function drawText(page: Page, label: string, x: number, y: number) {
  const canvas = page.locator('[aria-label="Whiteboard canvas"] canvas').first();
  await expect(canvas).toBeVisible();
  const bounds = (await canvas.boundingBox())!;
  await page.getByRole('radio', { name: 'Text', exact: true }).locator('..').click();
  await page.mouse.click(bounds.x + x, bounds.y + y);
  const textarea = page.locator('.excalidraw textarea').last();
  await expect(textarea).toBeFocused();
  await textarea.fill(label);
  await page.keyboard.press('Escape');
}

async function selectText(page: Page, board: Board, label: string) {
  const shape = board.scene.elements.find((element) => element.type === 'text' && element.text === label);
  if (!shape) throw new Error(`No saved shape with label ${label}`);
  const tool = page.getByRole('radio', { name: 'Selection', exact: true });
  await tool.locator('..').click();
  await expect(tool).toBeChecked();
  const canvas = page.locator('[aria-label="Whiteboard canvas"] canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  // Choosing a toolbar tool can scroll the page. Measure after that scroll,
  // allowing the editor's layout refresh to run before clicking saved content.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const bounds = (await canvas.boundingBox())!;
  const app = board.scene.app_state as {
    scrollX?: number;
    scrollY?: number;
    zoom?: number | { value?: number };
  };
  const zoom = typeof app.zoom === 'number' ? app.zoom : (app.zoom?.value ?? 1);
  const x = (Number(shape.x) + (app.scrollX ?? 0) + Number(shape.width) / 2) * zoom;
  const y = (Number(shape.y) + (app.scrollY ?? 0) + Number(shape.height) / 2) * zoom;
  await page.mouse.click(bounds.x + x, bounds.y + y);
}

async function downloadBoard(page: Page, area: 'full' | 'selection', format: 'png' | 'svg' | 'pdf') {
  await page
    .getByRole('combobox', { name: 'Board area', exact: true })
    .selectOption(area, { timeout: 8_000 });
  await page.getByRole('combobox', { name: 'File format', exact: true }).selectOption(format);
  const result = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download file', exact: true }).click();
  const download = await result;
  return { name: download.suggestedFilename(), data: await readFile((await download.path())!) };
}

test('exports whole and selected areas with matching labels and dimensions in all three formats', async ({
  page,
  context,
}) => {
  const api = await installApi(context);
  await page.goto('/');
  await drawText(page, 'Energy boundary', 300, 200);
  await drawText(page, 'Outside selection', 640, 290);
  await editAndSave(page, 'Energy & motion');
  await page.getByText('Download board', { exact: true }).click();
  const board = [...api.boards.get('Bearer whiteboard-user-a')!.values()][0]!;
  await selectText(page, board, 'Energy boundary');

  await mkdir('.tmp-playwright/e08', { recursive: true });
  for (const scope of ['full', 'selection'] as const) {
    const { name, data } = await downloadBoard(page, scope, 'svg');
    expect(name).toBe(`Energy-motion-${scope === 'full' ? 'board' : 'selection'}.svg`);
    await writeFile('.tmp-playwright/e08/' + scope + '.svg', data);
    const xml = data.toString('utf8');
    expect(xml).toContain(
      scope === 'full'
        ? '<title>Energy &amp; motion</title>'
        : '<title>Energy &amp; motion (selection)</title>',
    );
    expect(xml).toContain('Energy boundary');
    expect(xml.includes('Outside selection')).toBe(scope === 'full');
    const bounds = xml.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    expect(bounds).not.toBeNull();
    const png = (await downloadBoard(page, scope, 'png')).data;
    await writeFile('.tmp-playwright/e08/' + scope + '.png', png);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(Math.ceil(Number(bounds?.[1])));
    expect(height).toBe(Math.ceil(Number(bounds?.[2])));
    expect(width).toBeGreaterThan(scope === 'full' ? 350 : 80);
    expect(width).toBeLessThan(scope === 'full' ? 600 : 250);
    const pdfBytes = (await downloadBoard(page, scope, 'pdf')).data;
    await writeFile('.tmp-playwright/e08/' + scope + '.pdf', pdfBytes);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getTitle()).toBe(scope === 'full' ? 'Energy & motion' : 'Energy & motion (selection)');
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: width * 0.75, height: height * 0.75 });
  }
});

test('selected-area tutor, flashcards and map require a current preview before any board mutation', async ({
  page,
  context,
}) => {
  const api = await installApi(context);
  await page.goto('/');
  await drawText(page, 'Energy is conserved in an isolated system.', 320, 205);
  await drawText(page, 'Private material outside the chosen area.', 600, 300);
  await editAndSave(page, 'Review lab');
  await page.getByText('Study selected area', { exact: true }).click();
  const authoredBoard = [...api.boards.get('Bearer whiteboard-user-a')!.values()][0]!;
  await selectText(page, authoredBoard, 'Energy is conserved in an isolated system.');
  await expect(page.getByText('1 text shape selected.')).toBeVisible();
  const preview = page.getByRole('region', { name: 'Selected area learning preview' });
  const previewButton = page.getByRole('button', { name: 'Preview learning action', exact: true });
  const accept = preview.getByRole('button', { name: 'Add reviewed shapes' });
  const priorMutations = api.mutations.length;
  await page.getByLabel('Question for selected text').fill('What is conserved?');
  await previewButton.click();
  await expect(preview).toContainText('Conservation applies within the chosen boundary.');
  await preview.getByText('Review selected sources', { exact: true }).click();
  await expect(preview).toContainText('Energy is conserved in an isolated system.');
  await expect(preview).not.toContainText('Private material');
  expect(api.previews[0]).toMatchObject({
    owner: 'Bearer whiteboard-user-a',
    question: 'What is conserved?',
  });
  expect(api.previews[0]?.shape_ids).toHaveLength(1);
  expect(api.mutations).toHaveLength(priorMutations);
  await preview.getByRole('button', { name: 'Discard preview' }).click();
  await expect(preview).toHaveCount(0);
  expect(api.mutations).toHaveLength(priorMutations);

  await page.getByLabel('Learning action').selectOption('cards');
  await previewButton.click();
  await expect(preview).toContainText('What defines the system?');
  const boardId = api.previews.at(-1)!.id;
  const boards = api.boards.get('Bearer whiteboard-user-a')!;
  const board = boards.get(boardId)!;
  boards.set(boardId, { ...board, revision: board.revision + 1 });
  await accept.click();
  await expect(page.getByRole('alert')).toContainText('The board or selection changed.');
  expect(api.mutations).toHaveLength(priorMutations);
  boards.set(boardId, board);
  // Follow the stale-preview instruction and review the current selection again.
  const previewsBeforeRetry = api.previews.length;
  await previewButton.click();
  await expect(preview).toContainText('What defines the system?');
  expect(api.previews).toHaveLength(previewsBeforeRetry + 1);
  expect(api.mutations).toHaveLength(priorMutations);
  await accept.click();
  await expect(page.getByText('Flashcards added to the board.')).toBeVisible();
  await saved(page);
  expect(boards.get(boardId)?.scene.elements.map((shape) => shape.text)).toEqual(
    expect.arrayContaining(['Q: What defines the system?', 'A: A chosen boundary.']),
  );

  await page.getByLabel('Learning action').selectOption('map');
  await previewButton.click();
  await expect(preview).toContainText('System boundary');
  await expect(preview).toContainText('Energy transfer');
  await inspectLocalScreen(
    page,
    'whiteboard-learning',
    page.locator('details').filter({
      has: page.getByText('Study selected area', { exact: true }),
    }),
  );
  await keyboardTo(page, accept);
  await expect(accept).toBeFocused();
  const beforeMap = api.mutations.length;
  await page.setViewportSize({ width: 390, height: 844 });
  await preview.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);
  await page.screenshot({ path: '.tmp-playwright/e08/board-learning-390.png' });
  await page.keyboard.press('Enter');
  await expect(page.getByText('Concept map added to the board.')).toBeVisible();
  await saved(page);
  expect(api.mutations.length).toBeGreaterThan(beforeMap);
  expect(boards.get(boardId)?.scene.elements.filter((shape) => shape.type === 'arrow')).toHaveLength(2);
  await page.getByLabel('Fixture account').selectOption('whiteboard-user-b');
  await expect(preview).toHaveCount(0);
});
