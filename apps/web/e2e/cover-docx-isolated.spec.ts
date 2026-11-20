import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const ratioPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAFElEQVR4nGP4z8DwHxmD0P//SHwAEx0P8XBy1ZAAAAAASUVORK5CYII=';

test('downloads editable DOCX covers for all approved templates on A4 and Letter', async ({ page }) => {
  await page.goto('/');
  const builder = page.locator('main');
  await builder
    .locator('input[maxlength="400"]')
    .fill('Café Algorithms for reliable paths across a large campus network');
  await builder.getByLabel('Institution', { exact: true }).fill('Université de Montréal');
  await builder.getByLabel('Department').fill('Computer Science');
  await builder.getByLabel('Course code').fill('CS 240');
  await builder.getByLabel('Course name').fill('Algorithms and Data Structures');
  await builder.getByRole('button', { name: 'Add student' }).click();
  await builder.getByLabel('Student 1 name').fill('Rosa Pérez');
  await builder.getByLabel('Student 1 ID').fill('S-242');
  await builder.getByLabel('Instructor').fill('Prof. Nguyen');
  await builder.getByLabel('Submission date').fill('2026-11-20');
  await builder
    .locator('#cover-logo')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(ratioPng, 'base64') });
  await mkdir('../../output/docx/e11', { recursive: true });
  for (const [id, label] of [
    ['university-assignment', 'University assignment'],
    ['lab-report', 'Lab report'],
    ['project-report', 'Project report'],
    ['minimal-professional', 'Minimal professional'],
  ]) {
    await builder.getByRole('radio', { name: `Select ${label} template` }).click();
    for (const size of ['a4', 'letter']) {
      await builder.getByLabel('Paper size').selectOption(size);
      const button = builder.getByRole('button', { name: 'Download editable DOCX' });
      await expect(button).toBeEnabled();
      const pending = page.waitForEvent('download');
      await button.click();
      const downloaded = await pending;
      expect(downloaded.suggestedFilename()).toMatch(/\.docx$/u);
      const path = await downloaded.path();
      if (!path) throw new Error('DOCX download missing');
      const bytes = await readFile(path);
      expect(bytes.subarray(0, 4)).toEqual(Buffer.from([80, 75, 3, 4]));
      await writeFile(`../../output/docx/e11/${id}-${size}.docx`, bytes);
      await page.screenshot({ path: `../../output/docx/e11/${id}-${size}-editor.png`, fullPage: true });
    }
  }
  await builder.locator('input[maxlength="400"]').fill('বাংলা');
  await expect(builder.getByRole('button', { name: 'Download editable DOCX' })).toBeDisabled();
});
