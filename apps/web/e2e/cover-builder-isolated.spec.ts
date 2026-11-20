import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const ratioPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAFElEQVR4nGP4z8DwHxmD0P//SHwAEx0P8XBy1ZAAAAAASUVORK5CYII=';

for (const [label, key, paper] of [
  ['University assignment', 'university', 'a4'],
  ['Lab report', 'lab', 'letter'],
  ['Project report', 'project', 'a4'],
  ['Minimal professional', 'minimal', 'letter'],
] as const) {
  test(`downloads an editable ${label} cover`, async ({ page }, testInfo) => {
    await page.goto('/');
    const builder = page
      .locator('main')
      .filter({ has: page.getByRole('heading', { name: 'Academic cover page' }) });
    await builder.getByRole('radio', { name: `Select ${label} template` }).click();
    await builder.getByLabel('Paper size').selectOption(paper);
    await builder
      .locator('input[maxlength="400"]')
      .fill('Research Methods for Water Quality and Reliable Sampling');
    await builder.getByLabel('Institution', { exact: true }).fill('Lake & River University');
    await builder.getByLabel('Course code').fill('ENV 201');
    await builder.getByRole('button', { name: 'Add student' }).click();
    await builder.getByLabel('Student 1 name').fill('Rosa Pérez');
    await builder.getByLabel('Student 1 ID').fill('S-120');
    await builder.locator('#cover-logo').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ratioPng, 'base64'),
    });
    const save = page.waitForEvent('download');
    await builder.getByRole('button', { name: 'Download editable DOCX' }).click();
    const download = await save;
    expect(download.suggestedFilename()).toBe(
      'research-methods-for-water-quality-and-reliable-sampling.docx',
    );
    const path = testInfo.outputPath(`${key}.docx`);
    await download.saveAs(path);
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 3, 4]));
    expect(bytes.includes(Buffer.from('word/document.xml'))).toBe(true);
    expect(bytes.includes(Buffer.from('<w:t xml:space="preserve">Lake &amp; River University</w:t>'))).toBe(
      true,
    );
    expect(bytes.includes(Buffer.from('Rosa Pérez · ID: S-120'))).toBe(true);
    expect(bytes.includes(Buffer.from('Institution logo'))).toBe(true);
    await expect(builder.getByRole('heading', { name: 'Saved PDF copies' })).toHaveCount(0);
  });
}

test('blocks both academic export formats for unverified Bangla shaping', async ({ page }) => {
  await page.goto('/');
  const builder = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Academic cover page' }) });
  await builder.locator('input[maxlength="400"]').fill('শিক্ষা প্রতিবেদন');
  await expect(builder.getByRole('note')).toContainText('Bangla export is unavailable');
  await expect(builder.getByRole('button', { name: 'Download editable DOCX' })).toBeDisabled();
  await expect(builder.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
});

test('uses a distinct design for each template and keeps choices visible during editing', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const builder = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Academic cover page' }) });
  const designs = [
    ['University assignment', '#13294b'],
    ['Lab report', '#0f7784'],
    ['Project report', '#7542b3'],
    ['Minimal professional', '#a74932'],
  ];

  const title = builder.locator('input[maxlength="400"]');
  await title.clear();
  for (const [name, color] of designs) {
    const choice = builder.getByRole('radio', { name: `Select ${name} template` });
    await expect(choice.locator(`svg rect[fill="${color}"]`).first()).toBeVisible();
  }

  await title.fill('Study methods');
  await builder.getByLabel('Institution', { exact: true }).fill('North Campus University');
  await builder.getByLabel('Course name').fill('Research and analysis');
  for (const [name, color] of designs) {
    await builder.getByRole('radio', { name: `Select ${name} template` }).click();
    const preview = builder.getByRole('img', { name: `${name} cover preview, a4` });
    await expect(preview.locator(`rect[fill="${color}"]`).first()).toBeVisible();
    await expect(preview).toContainText('Study methods');
    const downloadPromise = page.waitForEvent('download');
    await builder.getByRole('button', { name: 'Download PDF' }).click();
    const download = await downloadPromise;
    const output = testInfo.outputPath(`${name}.pdf`);
    await download.saveAs(output);
    expect((await PDFDocument.load(await readFile(output))).getPageCount()).toBe(1);
  }
});

test('previews template layouts and exports a matched A4 PDF with wrapping, accents, and a proportional logo', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const builder = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Academic cover page' }) });
  await builder.getByRole('radio', { name: 'Select Project report template' }).click();
  await builder.getByLabel('Paper size').selectOption('a4');
  const title = 'Café – Algorithms for reliable paths across a very large campus network';
  await builder.locator('input[maxlength="400"]').fill(title, { timeout: 20_000 });
  await builder.getByLabel('Institution', { exact: true }).fill('Université de Montréal');
  await builder.getByLabel('Course code').fill('CS 240');
  await builder.getByLabel('Course name').fill('Algorithms and Data Structures');
  await builder.getByRole('button', { name: 'Add student' }).click();
  await builder.getByLabel('Student 1 name').fill('Rosa Pérez');
  await builder.getByLabel('Student 1 ID').fill('S-242');
  await builder.getByLabel('Student 1 section').fill('A');
  await builder.getByLabel('Group name').fill('Équipe rivière');
  await builder.getByLabel('Instructor').fill('Prof. Nguyen');
  await builder.getByLabel('Submission date').fill('2026-11-19');
  await builder.locator('#cover-logo').setInputFiles({
    name: 'university-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(ratioPng, 'base64'),
  });

  const preview = builder.getByRole('img', { name: /cover preview, a4/i });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Café');
  await expect(preview).toContainText('Rosa Pérez');
  await expect(preview).toContainText('Université de Montréal');
  await expect(preview.getByText('Équipe rivière', { exact: true })).toBeVisible();
  await expect(preview).not.toContainText('Experiment');
  await expect(preview.locator('image')).toHaveCount(1);
  const image = preview.locator('image');
  const logoWidth = Number(await image.getAttribute('width'));
  const logoHeight = Number(await image.getAttribute('height'));
  expect(logoWidth / logoHeight).toBeCloseTo(2, 5);

  const downloadPromise = page.waitForEvent('download');
  await builder.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    'cafe-algorithms-for-reliable-paths-across-a-very-large-campus-ne.pdf',
  );
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('The PDF download did not produce a local file.');
  const bytes = await readFile(downloadPath);
  const verifiedPdfPath = testInfo.outputPath('cover-acceptance.pdf');
  await mkdir(dirname(verifiedPdfPath), { recursive: true });
  await writeFile(verifiedPdfPath, bytes);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0)?.getSize().width).toBeCloseTo(595.28, 2);
  expect(pdf.getPage(0)?.getSize().height).toBeCloseTo(841.89, 2);
  expect(Buffer.from(bytes).includes(Buffer.from('/XObject', 'latin1'))).toBe(true);
  const artifactDownload = page.waitForEvent('download');
  await builder.getByRole('button', { name: 'Download copy' }).click();
  const artifact = await artifactDownload;
  const artifactPath = await artifact.path();
  if (!artifactPath) throw new Error('The saved PDF copy did not produce a local file.');
  expect(await readFile(artifactPath)).toEqual(bytes);
});

test('keeps absent optional fields out of the preview and lets the keyboard select a template', async ({
  page,
}) => {
  await page.goto('/');
  const builder = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Academic cover page' }) });
  const cover = builder.getByRole('img', { name: /university assignment cover preview/i });
  await expect(cover).toContainText('Course assignment');
  await expect(cover).not.toContainText('North Campus');
  await expect(cover).not.toContainText('Instructor');
  const lab = builder.getByRole('radio', { name: 'Select Lab report template' });
  await lab.focus();
  await page.keyboard.press('Enter');
  await expect(lab).toHaveAttribute('aria-checked', 'true');
  await expect(builder.getByRole('img', { name: /lab report cover preview/i })).toBeVisible();
});

test('saves and restores an account-scoped draft and a versioned institution preset after reload', async ({
  page,
}) => {
  await page.goto('/');
  const builder = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Academic cover page' }) });
  await builder.locator('input[maxlength="400"]').fill('Water quality report');
  await builder.getByLabel('Institution', { exact: true }).fill('Lake University');
  await builder.getByLabel('Department').fill('Environmental Science');
  await builder.getByLabel('Course code').fill('ENV 201');
  await builder.getByLabel('Preset name').fill('Lake field lab');
  await builder.getByRole('button', { name: 'Save preset' }).click();
  await expect(builder.getByRole('status')).toContainText('preset revision 1');

  await builder.getByRole('button', { name: 'Save draft' }).click();
  await expect(builder.getByRole('status')).toContainText('draft revision 1');
  await page.reload();
  const reloaded = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Academic cover page' }) });
  await reloaded.getByLabel('Institution preset').selectOption({ label: 'Lake field lab · v1' });
  await reloaded.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(reloaded.getByLabel('Institution', { exact: true })).toHaveValue('Lake University');
  await reloaded.getByLabel('Saved cover draft').selectOption({ label: 'Water quality report · v1' });
  await reloaded.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(reloaded.locator('input[maxlength="400"]')).toHaveValue('Water quality report');
  await expect(reloaded.getByLabel('Course code')).toHaveValue('ENV 201');
  await expect(reloaded.getByRole('note')).toContainText('Bangla export is unavailable');
});

test('downloads the verified PDF even if the browser cannot retain an artifact copy', async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('Storage is full.', 'QuotaExceededError');
    };
  });
  await page.goto('/');
  const builder = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Academic cover page' }) });
  const downloadPromise = page.waitForEvent('download');
  await builder.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('course-assignment.pdf');
  await expect(builder.getByRole('alert')).toContainText(
    'PDF downloaded, but its browser copy could not be saved',
  );
});

test('clears the editor on an account switch and isolates saved cover drafts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const builder = page
    .locator('main')
    .filter({ has: page.getByRole('heading', { name: 'Academic cover page' }) });
  await builder.locator('input[maxlength="400"]').fill('Private learner A report');
  await builder.getByRole('button', { name: 'Save draft' }).click();
  await expect(builder.getByRole('status')).toContainText('draft revision 1');
  await page.getByLabel('Test account').selectOption('fixture-cover-other');
  await expect(builder.locator('input[maxlength="400"]')).toHaveValue('Course assignment');
  await expect(builder.getByLabel('Saved cover draft').locator('option')).toHaveCount(1);
  await expect(builder.getByLabel('Saved cover draft')).not.toContainText('Private learner A report');
  await page.getByLabel('Test account').selectOption('fixture-cover-learner');
  await builder.getByLabel('Saved cover draft').selectOption({ label: 'Private learner A report · v1' });
  await builder.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(builder.locator('input[maxlength="400"]')).toHaveValue('Private learner A report');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
