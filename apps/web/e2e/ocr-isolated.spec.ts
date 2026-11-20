import path from 'node:path';
import { expect, test } from '@playwright/test';
import { SessionResponseSchema } from '@studyvault/types';
import { inspectLocalScreen, keyboardTo } from './helpers/local-accessibility';

const sample = (language: string) => path.join('e2e', 'fixtures', 'ocr', `${language}.png`);
const authorization = { Authorization: 'Bearer ocr-fixture-owner' };

test('reads cropped English and saves only the corrected text to the chosen course lesson', async ({
  page,
  request,
}) => {
  const external: string[] = [];
  page.context().on('request', (outgoing) => {
    if (
      !outgoing.url().startsWith('http://127.0.0.1:4345/') &&
      !outgoing.url().startsWith('http://127.0.0.1:4346/')
    )
      external.push(outgoing.url());
  });
  const response = await request.post('/api/courses/python-foundations/enroll', {
    headers: authorization,
    data: { diagnostic_answers: {} },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const enrollment = SessionResponseSchema.parse(await response.json());
  await page.goto('/');
  await page.getByLabel('Choose an image').setInputFiles(sample('english'));
  const canvas = page.getByRole('img', { name: 'Cropped and rotated image preview' });
  await expect(canvas).toHaveAttribute('width', '980');
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await expect(canvas).toHaveAttribute('width', '300');
  await page.getByRole('button', { name: 'Reset image' }).click();
  await page.getByRole('slider', { name: 'Crop bottom (%)' }).fill('42');
  await keyboardTo(page, page.getByRole('slider', { name: 'Crop bottom (%)' }));
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('slider', { name: 'Crop bottom (%)' })).toHaveValue('43');
  await page.keyboard.press('ArrowLeft');
  await expect(canvas).toHaveAttribute('height', '174');
  await page.getByRole('button', { name: 'Read image', exact: true }).click();
  const text = page.getByLabel('Recognized text');
  await expect(text).toHaveValue(/energy is conserved/i, { timeout: 40_000 });
  expect(await text.inputValue()).not.toContain('BOTTOM');
  await expect(page.getByText(/OCR confidence estimate/)).toBeVisible();
  await text.fill('Energy is conserved in an isolated system. Corrected from my image.');
  await inspectLocalScreen(page, 'ocr-english', page.getByRole('region', { name: 'Image to notes' }));
  await page.getByRole('button', { name: 'Choose a course note' }).click();
  await page.getByLabel('Course enrollment').selectOption(enrollment.id);
  await page.getByRole('button', { name: 'Add to lesson notes' }).click();
  await expect(page.getByText('Note saved.')).toBeVisible();
  const saved = await request.get(`/api/course-enrollments/${enrollment.id}`, { headers: authorization });
  expect(SessionResponseSchema.parse(await saved.json()).notes).toEqual([
    expect.objectContaining({ lesson_id: enrollment.lesson.id, text: await text.inputValue() }),
  ]);
  await expect.poll(() => page.workers().length).toBe(0);
  expect(external).toEqual([]);
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await expect(
    page.getByText('The image settings changed. Read the image again before saving its text.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose a course note' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ocr-corrected-390.png', fullPage: true });
});

test('releases a cancelled or failed worker and reads a real Bangla sample on retry', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByLabel('Choose an image').setInputFiles(sample('bangla'));
  await page.getByLabel('Text language').selectOption('ben');
  const read = page.getByRole('button', { name: 'Read image', exact: true });
  const workerPath = '**/ocr-worker.ts?*';
  await context.route(workerPath, async (route) => {
    await route.abort();
  });
  await read.click();
  await expect(page.getByRole('alert')).toContainText(/worker could not read|Could not load OCR/);
  await expect.poll(() => page.workers().length).toBe(0);
  await context.unroute(workerPath);

  await read.click();
  await page.getByRole('button', { name: 'Cancel OCR' }).click();
  await expect(page.getByText('OCR cancelled.')).toBeVisible();
  await expect.poll(() => page.workers().length).toBe(0);
  await read.click();
  await expect(page.getByLabel('Recognized text')).toHaveValue(/বাংলা ভাষা/, { timeout: 40_000 });
  await expect.poll(() => page.workers().length).toBe(0);
  await page.screenshot({ path: 'test-results/ocr-bangla-390.png', fullPage: true });
  await inspectLocalScreen(page, 'ocr-bangla', page.getByRole('region', { name: 'Image to notes' }));
});

test('corrects a sideways original with rotation before real OCR', async ({ page }) => {
  await page.goto('/');
  const rotated = await page.evaluate(async () => {
    const bitmap = await createImageBitmap(await (await fetch('/english.png')).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.height;
    canvas.height = bitmap.width;
    const context = canvas.getContext('2d')!;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    bitmap.close();
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page
    .getByLabel('Choose an image')
    .setInputFiles({ name: 'sideways.png', mimeType: 'image/png', buffer: Buffer.from(rotated, 'base64') });
  const canvas = page.getByRole('img', { name: 'Cropped and rotated image preview' });
  await expect(canvas).toHaveAttribute('width', '300');
  for (let index = 0; index < 3; index += 1) await page.getByRole('button', { name: 'Rotate right' }).click();
  await expect(canvas).toHaveAttribute('width', '980');
  await page.getByRole('button', { name: 'Read image', exact: true }).click();
  await expect(page.getByLabel('Recognized text')).toHaveValue(/energy is conserved/i, { timeout: 40_000 });
  await expect.poll(() => page.workers().length).toBe(0);
});

test('rejects invalid images, preserves retry, and isolates an in-flight OCR account change', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Choose an image')
    .setInputFiles({ name: 'corrupt.png', mimeType: 'image/png', buffer: Buffer.from('not image bytes') });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read image', exact: true })).toHaveCount(0);
  await page.getByLabel('Choose an image').setInputFiles(sample('english'));
  let release = () => {};
  let intercepted = false;
  await context.route('**/ocr-worker.ts?*', async (route) => {
    intercepted = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.continue().catch(() => {}); // The account change intentionally terminates this request.
  });
  await page.getByRole('button', { name: 'Read image', exact: true }).click();
  await expect.poll(() => intercepted).toBe(true);
  await page.getByLabel('Fixture account').selectOption('ocr-fixture-other');
  release();
  await expect(page.getByLabel('Recognized text')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Cropped and rotated image preview' })).toHaveCount(0);
  await expect.poll(() => page.workers().length).toBe(0);
  await context.unroute('**/ocr-worker.ts?*');
  await page.getByLabel('Choose an image').setInputFiles(sample('english'));
  await page.getByRole('button', { name: 'Read image', exact: true }).click();
  await expect(page.getByLabel('Recognized text')).toHaveValue(/energy is conserved/i, { timeout: 40_000 });
});

test('a lost note-save response reconciles the committed note without duplicate text', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/courses/python-foundations/enroll', {
    headers: { Authorization: 'Bearer ocr-fixture-owner' },
    data: { diagnostic_answers: {} },
  });
  const enrollment = SessionResponseSchema.parse(await response.json());
  await page.goto('/');
  await page.getByLabel('Choose an image').setInputFiles(sample('english'));
  await page.getByRole('button', { name: 'Read image', exact: true }).click();
  await expect(page.getByLabel('Recognized text')).toHaveValue(/energy is conserved/i, { timeout: 40_000 });
  const corrected = 'Corrected note with an uncertain number checked against my image.';
  await page.getByLabel('Recognized text').fill(corrected);
  await page.getByRole('button', { name: 'Choose a course note' }).click();
  await page.getByLabel('Course enrollment').selectOption(enrollment.id);
  let writes = 0;
  await page.route(
    `**/api/learning-service/api/course-enrollments/${enrollment.id}/study-notes`,
    async (route) => {
      writes += 1;
      await route.fetch();
      await route.abort('failed');
    },
  );
  await page.getByRole('button', { name: 'Add to lesson notes' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Add to lesson notes' }).click();
  await expect(page.getByText('Note saved.')).toBeVisible();
  expect(writes).toBe(1);
  const current = SessionResponseSchema.parse(
    await (await request.get(`/api/course-enrollments/${enrollment.id}`, { headers: authorization })).json(),
  );
  expect(current.notes.filter((note) => note.text.includes(corrected))).toHaveLength(1);
  expect(
    current.notes.find((note) => note.lesson_id === enrollment.lesson.id)?.text.split(corrected),
  ).toHaveLength(2);
  await page.getByLabel('Recognized text').fill('Another correction after the previous save.');
  await expect(page.getByText('Note saved.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to lesson notes' })).toBeEnabled();
});
