import { mkdir, writeFile } from 'node:fs/promises';
import { expect, type Locator, type Page } from '@playwright/test';

/** Focused local checks, not a substitute for human assistive-technology testing. */
export async function keyboardTo(page: Page, target: Locator, attempts = 100) {
  for (let index = 0; index < attempts; index++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) {
      const focus = await target.evaluate((element) => ({
        visible: element.matches(':focus-visible'),
        outline: Number.parseFloat(getComputedStyle(element).outlineWidth),
      }));
      expect(focus.visible).toBe(true);
      expect(focus.outline).toBeGreaterThanOrEqual(2);
      return;
    }
  }
  throw new Error('The control was not reachable by Tab.');
}

export async function inspectLocalScreen(page: Page, name: string, root: Locator) {
  const folder = '.tmp-playwright/h05';
  await mkdir(folder, { recursive: true });
  const reports = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    const report = await root.evaluate((region) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      const rgba = (color: string): number[] => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      };
      const over = (front: number[], back: number[]) => {
        const alpha = front[3]! / 255;
        return [0, 1, 2].map((channel) => front[channel]! * alpha + back[channel]! * (1 - alpha)).concat(255);
      };
      const luma = (color: number[]) => {
        const linear = color.slice(0, 3).map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
      };
      const violations: Array<{ text: string; contrast: number; minimum: number }> = [];
      const unnamed: string[] = [];
      let checked = 0;
      for (const element of Array.from(region.querySelectorAll<HTMLElement>('*'))) {
        const bounds = element.getBoundingClientRect();
        if (
          bounds.width < 2 ||
          bounds.height < 2 ||
          !element.getClientRects().length ||
          element.closest('[hidden], [aria-hidden="true"], :disabled')
        )
          continue;
        const style = getComputedStyle(element);
        if (style.visibility !== 'visible' || style.display === 'none') continue;
        if (element.matches('input:not([type="hidden"]), select, textarea, button')) {
          const labels = 'labels' in element ? Array.from((element as HTMLInputElement).labels ?? []) : [];
          const named =
            element.getAttribute('aria-label') ||
            element.getAttribute('aria-labelledby') ||
            labels
              .map((label) => label.textContent)
              .join('')
              .trim() ||
            element.textContent?.trim() ||
            element.getAttribute('title');
          if (!named && !element.matches('input[type="button"], input[type="submit"]'))
            unnamed.push(element.tagName);
        }
        const text = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join('')
          .trim();
        if (!text) continue;
        const ancestors: HTMLElement[] = [];
        let parent: HTMLElement | null = element;
        let hasImage = false;
        while (parent) {
          if (getComputedStyle(parent).backgroundImage !== 'none') hasImage = true;
          ancestors.push(parent);
          parent = parent.parentElement;
        }
        if (hasImage) continue;
        let background = [255, 255, 255, 255];
        for (const ancestor of ancestors.reverse())
          background = over(rgba(getComputedStyle(ancestor).backgroundColor), background);
        const foreground = over(rgba(style.color), background);
        const a = luma(foreground),
          b = luma(background);
        const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const size = Number.parseFloat(style.fontSize);
        const weight = Number.parseInt(style.fontWeight, 10);
        const minimum = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
        checked++;
        if (contrast + 0.03 < minimum)
          violations.push({ text: text.slice(0, 100), contrast: Math.round(contrast * 100) / 100, minimum });
      }
      return {
        contrast_samples: checked,
        low_contrast_text: violations,
        unnamed_controls: unnamed,
        reduced_motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        running_animations: region
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running').length,
      };
    });
    reports.push({ width, ...report });
    await writeFile(`${folder}/${name}-${width}.aria.yml`, await root.ariaSnapshot());
    await root.screenshot({ path: `${folder}/${name}-${width}.png` });
    expect(report.unnamed_controls, `${name} ${width} unnamed native controls`).toEqual([]);
    expect(report.low_contrast_text, `${name} ${width} sampled text contrast`).toEqual([]);
    expect(report.reduced_motion).toBe(true);
    expect(report.running_animations).toBe(0);
  }
  await writeFile(`${folder}/${name}.json`, JSON.stringify(reports, null, 2));
}
