import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('renders the integrated toolkit with its real global and whiteboard styles', async ({ page }) => {
  await page.route('**/api/whiteboards**', (route) =>
    route.fulfill({ json: { items: [], limit: 100, offset: 0, total_count: 0 } }),
  );
  await page.route('**/api/learning-service/api/bibliography**', (route) =>
    route.fulfill({
      json: {
        ...(new URL(route.request().url()).pathname.endsWith('/library-documents')
          ? { documents: [] }
          : { items: [] }),
        limit: 100,
        offset: 0,
        total_count: 0,
      },
    }),
  );
  await page.goto('/');
  const cover = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Academic cover page', exact: true }) });
  await expect(cover.getByRole('img', { name: /cover preview/ })).toBeVisible();
  await expect(page.locator('[aria-label="Whiteboard canvas"] canvas').first()).toBeVisible();
  const folder = '../../output/tools-responsive-' + (process.env.TOOLS_LAYOUT_STAGE ?? 'current');
  await mkdir(folder, { recursive: true });
  const report = [];
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshot = await page.screenshot({ path: `${folder}/tools-${width}.png`, fullPage: true });
    const coverBounds = await cover.boundingBox();
    if (!coverBounds) throw new Error('Cover panel has no rendered dimensions');
    // Crop the real full-page capture: locator screenshots scroll a tall panel
    // beneath the sticky app header, which would obscure the top of the editor.
    const cropped = await page.evaluate(
      async ({ image, bounds }) => {
        const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + image)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(bounds.width);
        canvas.height = Math.ceil(bounds.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Screenshot crop canvas is unavailable');
        context.drawImage(
          bitmap,
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        bitmap.close();
        return canvas.toDataURL('image/png').split(',')[1]!;
      },
      { image: screenshot.toString('base64'), bounds: coverBounds },
    );
    await writeFile(`${folder}/cover-${width}.png`, Buffer.from(cropped, 'base64'));
    const measurement = await cover.evaluate((section, viewport) => {
      const measure = (element: Element | null) =>
        element
          ? {
              width: element.getBoundingClientRect().width,
              columns: getComputedStyle(element).gridTemplateColumns,
            }
          : null;
      return {
        viewport,
        browserWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        cover: measure(section),
        outerGrid: measure(section.parentElement),
        innerGrid: measure(section.querySelector('form')?.parentElement ?? null),
        title: measure(section.querySelector('input[maxlength="400"]')),
        preview: measure(section.querySelector('svg[role="img"]')),
        buttonBackground: getComputedStyle(section.querySelector('button[type="submit"]')!).backgroundColor,
        buttonWeight: getComputedStyle(section.querySelector('button[type="submit"]')!).fontWeight,
        controlOverflow: Array.from(section.querySelectorAll('input, select, textarea')).filter((control) => {
          const rect = control.getBoundingClientRect();
          const panel = section.getBoundingClientRect();
          return rect.width > 0 && (rect.left < panel.left || rect.right > panel.right + 1);
        }).length,
      };
    }, width);
    expect(measurement.documentWidth).toBeLessThanOrEqual(width);
    expect(measurement.outerGrid?.columns.split(' ')).toHaveLength(1);
    expect(measurement.innerGrid?.columns.split(' ')).toHaveLength(width === 1440 ? 2 : 1);
    expect(measurement.title!.width).toBeGreaterThanOrEqual(260);
    expect(measurement.preview!.width).toBeGreaterThanOrEqual(260);
    expect(measurement.controlOverflow).toBe(0);
    expect(Number(measurement.buttonWeight)).toBeGreaterThanOrEqual(500);
    expect(measurement.buttonBackground).not.toBe('rgba(0, 0, 0, 0)');
    const ocr = page.getByRole('region', { name: 'Image to notes' });
    const ocrBounds = await ocr.boundingBox();
    expect(ocrBounds!.y).toBeGreaterThanOrEqual(coverBounds.y + coverBounds.height);
    const source = ocr.getByRole('combobox', { name: /^Source format/ });
    await expect(source.locator('option')).toHaveText([
      'Image (PNG, JPG, WebP)',
      'PDF (text or scanned pages)',
      'Word document (.docx)',
    ]);
    for (const format of ['image', 'pdf', 'docx']) {
      await source.selectOption(format);
      const sourceBounds = await source.boundingBox();
      expect(sourceBounds!.width).toBeGreaterThanOrEqual(200);
      expect(sourceBounds!.x + sourceBounds!.width).toBeLessThanOrEqual(width);
      await ocr.screenshot({ path: `${folder}/ocr-${format}-${width}.png` });
    }
    await source.selectOption('image');
    report.push(measurement);
  }
  await writeFile(`${folder}/layout.json`, JSON.stringify(report, null, 2));
});
