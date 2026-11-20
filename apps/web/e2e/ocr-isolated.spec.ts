import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PDFDocument, PDFName, StandardFonts, drawObject } from 'pdf-lib';
import { strToU8, zipSync } from 'fflate';
import { SessionResponseSchema } from '@studyvault/types';
import { inspectLocalScreen, keyboardTo } from './helpers/local-accessibility';

const sample = (language: string) => path.join('e2e', 'fixtures', 'ocr', `${language}.png`);
const authorization = { Authorization: 'Bearer ocr-fixture-owner' };

test('imports all selectable PDF pages locally and releases the PDF worker on account change', async ({
  page,
}) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of ['Energy is conserved.', 'Momentum is also conserved.']) {
    const sheet = pdf.addPage([600, 800]);
    sheet.drawText(text, { x: 50, y: 700, size: 24, font });
  }
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4345/')) external.push(request.url());
  });
  await page.goto('/');
  await page.getByLabel('Source format').selectOption('pdf');
  await page
    .getByLabel('Choose a PDF', { exact: true })
    .setInputFiles({ name: 'study.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByText('PDF ready.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Extract PDF text', exact: true }).click();
  await expect(page.getByLabel('Recognized text')).toHaveValue(
    /Page 1\nEnergy is conserved\.[\s\S]*Page 2\nMomentum is also conserved\./,
  );
  await expect(page.getByText('OCR confidence estimate', { exact: false })).toHaveCount(0);
  await page.getByLabel('PDF page', { exact: true }).selectOption('2');
  await expect(page.getByRole('button', { name: 'Read PDF page', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Choose a course note' })).toBeVisible();
  await page.screenshot({ path: '../../output/ocr-document-imports/pdf-390.png', fullPage: true });
  expect(external).toEqual([]);
  await page.getByLabel('Fixture account').selectOption('ocr-fixture-other');
  await expect(page.getByLabel('Recognized text')).toHaveCount(0);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('recognizes a scanned multi-page PDF with real OCR and cancels without replacing a previous result', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(await readFile(sample('english')));
  for (let index = 0; index < 2; index++)
    pdf.addPage([980, 300]).drawImage(png, { x: 0, y: 0, width: 980, height: 300 });
  await page.goto('/');
  await page.getByLabel('Source format').selectOption('pdf');
  await page.getByLabel('Choose a PDF', { exact: true }).setInputFiles({
    name: 'scanned.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByRole('button', { name: 'Extract PDF text', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Extract PDF text', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No selectable text');
  await page.getByRole('button', { name: 'Read all PDF pages', exact: true }).click();
  const text = page.getByLabel('Recognized text');
  await expect(text).toHaveValue(/Page 1[\s\S]*energy is conserved[\s\S]*Page 2[\s\S]*energy is conserved/i, {
    timeout: 100_000,
  });
  await text.fill('My corrected PDF notes.');
  await page.getByRole('button', { name: 'Read all PDF pages', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel OCR', exact: true }).click();
  await expect(text).toHaveValue('My corrected PDF notes.');
  await expect(page.getByText('OCR cancelled.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read all PDF pages', exact: true })).toBeEnabled();
});

test('imports Unicode DOCX paragraphs and table text without deleted text or executable content', async ({
  page,
}) => {
  const xml =
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Energy &amp; momentum</w:t></w:r></w:p><w:p><w:r><w:t>বাংলা শেখা</w:t></w:r><w:del><w:r><w:t>DELETED SECRET</w:t></w:r></w:del><w:r><w:instrText>FIELD INSTRUCTION</w:instrText></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table note</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const docx = zipSync({ 'word/document.xml': strToU8(xml), 'word/unused.bin': new Uint8Array(1024) });
  await page.goto('/');
  await page.getByLabel('Source format').selectOption('docx');
  const input = page.getByLabel('Choose a Word document', { exact: true });
  await input.setInputFiles({
    name: 'old.doc',
    mimeType: 'application/msword',
    buffer: Buffer.from('legacy'),
  });
  await expect(page.getByRole('alert')).toContainText('Choose a .docx');
  await input.setInputFiles({
    name: 'notes.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(docx),
  });
  await expect(page.getByLabel('Recognized text')).toHaveValue(
    'Energy & momentum\n\nবাংলা শেখা\n\nTable note',
  );
  await page.getByLabel('Recognized text').fill('Reviewed বাংলা notes');
  await expect(page.getByRole('button', { name: 'Choose a course note' })).toBeVisible();
  await page.screenshot({ path: '../../output/ocr-document-imports/docx-390.png', fullPage: true });
  await page.getByLabel('Source format').selectOption('image');
  await expect(page.getByLabel('Recognized text')).toHaveCount(0);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('rejects corrupt and oversized document structures and remains retryable', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Source format').selectOption('pdf');
  const input = page.getByLabel('Choose a PDF', { exact: true });
  await input.setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('broken PDF'),
  });
  await expect(page.getByRole('alert')).toContainText('Could not open this PDF');
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 31; index++) pdf.addPage();
  await input.setInputFiles({
    name: 'too-many.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByRole('alert')).toContainText('30 pages or fewer');
  const oversizedImagePdf = await PDFDocument.create();
  const sheet = oversizedImagePdf.addPage();
  const image = oversizedImagePdf.context.flateStream(new Uint8Array(25_000_000).fill(255), {
    Type: 'XObject',
    Subtype: 'Image',
    Width: 5_000,
    Height: 5_000,
    ColorSpace: 'DeviceGray',
    BitsPerComponent: 8,
  });
  sheet.node.setXObject(PDFName.of('OversizedImage'), oversizedImagePdf.context.register(image));
  sheet.pushOperators(drawObject('OversizedImage'));
  await input.setInputFiles({
    name: 'large-image.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await oversizedImagePdf.save()),
  });
  await expect(page.getByRole('alert')).toContainText('16 million pixels');
  await page.getByLabel('Source format').selectOption('docx');
  const word = page.getByLabel('Choose a Word document', { exact: true });
  const oversized = zipSync({ 'word/document.xml': new Uint8Array(4 * 1024 * 1024 + 1) });
  await word.setInputFiles({
    name: 'large.docx',
    mimeType: 'application/zip',
    buffer: Buffer.from(oversized),
  });
  await expect(page.getByRole('alert')).toContainText('under 4 MB');
  const xml = '<!DOCTYPE document [<!ENTITY example "x">]><document>&example;</document>';
  await word.setInputFiles({
    name: 'unsafe.docx',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipSync({ 'word/document.xml': strToU8(xml) })),
  });
  await expect(page.getByRole('alert')).toContainText('unsupported XML');
  await expect(page.getByLabel('Recognized text')).toHaveCount(0);
  await expect(page.getByLabel('Source format')).toBeEnabled();
});

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
