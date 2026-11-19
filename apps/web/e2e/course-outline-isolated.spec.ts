import { expect, test, type Page } from '@playwright/test';
import { inspectLocalScreen, keyboardTo } from './helpers/local-accessibility';

async function attach(page: Page, objective: number, sourceTitle: string, segment = 1) {
  const detail = page.getByText(`Link evidence to objective ${objective}`, { exact: true });
  if (
    !(await page
      .getByRole('combobox', { name: `Source for objective ${objective}`, exact: true })
      .isVisible())
  )
    await detail.click();
  await page
    .getByRole('combobox', { name: `Source for objective ${objective}`, exact: true })
    .selectOption({ label: sourceTitle });
  await page
    .getByRole('combobox', { name: `Segment for objective ${objective}`, exact: true })
    .selectOption({ index: segment });
  await page.getByRole('button', { name: `Attach quote to objective ${objective}`, exact: true }).click();
}

test('two-source coverage, owner edits, exact approval, history and account isolation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (cause) => errors.push(cause.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Plan a private course' })).toBeVisible();
  await page.getByRole('checkbox', { name: /Physics book/ }).check();
  await page.getByRole('checkbox', { name: /Teaching repository/ }).check();
  await page.getByLabel('Course title', { exact: true }).fill('Conservation and evidence');
  await page
    .getByLabel('Learning outcome', { exact: true })
    .fill('Explain conservation laws and inspect their limits.');
  await page
    .getByLabel('Objectives, one per line')
    .fill('Explain energy conservation\nExplain momentum\nUnsupported advanced topic');
  await page.getByRole('button', { name: 'Create local outline', exact: true }).click();
  await attach(page, 1, 'Physics book');
  await attach(page, 1, 'Teaching repository');
  await attach(page, 2, 'Physics book', 2);
  await page.getByText('Flag a source conflict for objective 1', { exact: true }).click();
  await page
    .getByLabel('Conflict description for objective 1', { exact: true })
    .fill('Check which system boundary each excerpt assumes.');
  await page.getByRole('button', { name: 'Add conflict flag for objective 1', exact: true }).click();
  await page.getByRole('button', { name: 'Save outline and check coverage', exact: true }).click();
  const report = page.getByRole('region', { name: 'Saved coverage report', exact: true });
  await expect(report).toContainText('Missing support');
  await expect(report.locator('dl').getByText('1', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Approve saved outline', exact: true })).toBeDisabled();
  await expect(page.getByRole('group', { name: /Objective 3: Unsupported/ })).toContainText(
    'Saved coverage: gap',
  );
  await page.getByRole('button', { name: 'Remove objective 3', exact: true }).click();
  await page
    .getByLabel('Resolution for conflict 1', { exact: true })
    .fill('The excerpts discuss isolated versus interacting systems; teach that assumption explicitly.');
  await page.getByLabel('I reviewed the evidence for objective 1', { exact: true }).check();
  await page.getByLabel('I reviewed the evidence for objective 2', { exact: true }).check();
  await page.getByLabel('Estimated minutes for objective 1', { exact: true }).fill('45');
  await page.getByLabel('I reviewed the evidence for objective 1', { exact: true }).check();
  await page.getByRole('button', { name: 'Save outline and check coverage', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 2 saved');
  await page
    .getByLabel('I reviewed this exact saved outline, its sources and conflict resolutions.', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Approve saved outline', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Owner approved revision 2');
  await expect(page.getByText('Editorial: not reviewed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View approval history', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Immutable outline approvals' })).toContainText(
    'Approved revision 2',
  );
  await report.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/course-outline-approved-390.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await report.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/course-outline-approved-1440.png' });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByLabel('Outline to open')
    .selectOption({ label: 'Conservation and evidence — revision 2, approved' });
  await page.getByRole('button', { name: 'Open saved outline', exact: true }).click();
  await expect(page.getByText('Owner approved revision 2', { exact: true })).toBeVisible();
  await page.getByLabel('Outline title', { exact: true }).fill('Locally edited outline');
  await expect(page.getByRole('button', { name: 'Approve saved outline', exact: true })).toBeDisabled();
  await expect(page.getByText(/Unsaved changes/)).toBeVisible();
  await page.getByRole('button', { name: 'Save outline and check coverage', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revision 3 saved');
  await expect(page.getByText('Draft revision 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View approval history', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Immutable outline approvals' })).toContainText(
    'Approved revision 2',
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);
  await page.getByLabel('Acceptance account').selectOption('other');
  await expect(page.getByLabel('Course title', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Outline to open').locator('option')).toHaveCount(1);
  await expect(page.getByText('Locally edited outline', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Energy is conserved in an isolated system.', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('stale saves retain local edits until an explicit reload', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('outline-fixture-account', 'stale-owner'));
  await page.goto('/');
  await page.getByRole('checkbox', { name: /Physics book/ }).check();
  await page.getByLabel('Course title', { exact: true }).fill('Stale editing example');
  await page.getByLabel('Learning outcome', { exact: true }).fill('Inspect revision handling.');
  await page.getByLabel('Objectives, one per line').fill('Explain energy');
  await page.getByRole('button', { name: 'Create local outline', exact: true }).click();
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/api/course-outlines') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save outline and check coverage', exact: true }).click();
  const record = await (await created).json();
  const otherPlan = { ...record.plan, title: 'Other tab revision' };
  const update = await request.put(`http://127.0.0.1:4334/api/course-outlines/${record.id}`, {
    headers: { Authorization: 'Bearer outline-fixture-stale-owner' },
    data: { expected_revision: record.revision, plan: otherPlan },
  });
  expect(update.ok()).toBe(true);
  await page.getByLabel('Outline title', { exact: true }).fill('Keep these local edits');
  await page.getByRole('button', { name: 'Save outline and check coverage', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your local edits are still here');
  await expect(page.getByLabel('Outline title', { exact: true })).toHaveValue('Keep these local edits');
  await page
    .getByRole('button', { name: 'Reload saved revision (discard local changes)', exact: true })
    .click();
  await expect(page.getByLabel('Outline title', { exact: true })).toHaveValue('Other tab revision');
});

test('disabled planning shows a polite notice without editing or source preparation controls', async ({
  page,
}) => {
  await page.route(/\/api\/(?:source-versions|course-outlines)(?:\?|$)/, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }),
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Plan a private course' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Private course planning is not available in this environment yet.',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create local outline', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load library documents', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Prepare PDF version', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group')).toHaveCount(0);
  await expect(page.getByLabel('Acceptance account')).toBeEnabled();
});

test('temporary planning load errors remain visible and can be retried', async ({ page }) => {
  let unavailable = true;
  await page.route(/\/api\/(?:source-versions|course-outlines)(?:\?|$)/, async (route) => {
    if (unavailable)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'internal', message: 'Private planning is temporarily unavailable.' },
        }),
      });
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Private planning is temporarily unavailable.');
  await expect(page.getByRole('button', { name: 'Create local outline', exact: true })).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'Retry loading private outlines', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create local outline', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Physics book/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('local notes and text files become private outline evidence', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('outline-fixture-account', 'local-import'));
  await page.goto('/');
  await page.getByText('Import notes or a local file', { exact: true }).click();
  await keyboardTo(page, page.getByRole('combobox', { name: 'Source format', exact: true }));
  await expect(page.getByRole('combobox', { name: 'Source format', exact: true })).toBeFocused();
  await page.getByLabel('Source title', { exact: true }).fill('Owner workshop notes');
  await page
    .getByLabel('Notes text', { exact: true })
    .fill('Energy transfers between objects.\n    Preserve this indentation.');
  await page
    .getByLabel('Why are you allowed to use this source for private study?')
    .fill('I authored these workshop notes.');
  const imported = page.waitForResponse((response) =>
    response.url().endsWith('/api/source-versions/import-text'),
  );
  await page.getByRole('button', { name: 'Import source', exact: true }).click();
  const response = await imported;
  expect(response.ok()).toBe(true);
  const version = await response.json();
  expect(version.snapshot.origin.format).toBe('notes');
  await page.getByRole('checkbox', { name: /Owner workshop notes/ }).check();
  await page.getByLabel('Course title', { exact: true }).fill('Workshop course');
  await page.getByLabel('Learning outcome', { exact: true }).fill('Explain energy transfers.');
  await page.getByLabel('Objectives, one per line').fill('Explain energy transfers');
  await page.getByRole('button', { name: 'Create local outline', exact: true }).click();
  await attach(page, 1, 'Owner workshop notes');
  await page.getByLabel('I reviewed the evidence for objective 1', { exact: true }).check();
  await page.getByRole('button', { name: 'Save outline and check coverage', exact: true }).click();
  await expect(page.getByText(/Text lines 1–2/).first()).toBeVisible();

  await page.getByRole('combobox', { name: 'Source format', exact: true }).selectOption('txt');
  await page.getByLabel('Source title', { exact: true }).fill('Owner text file');
  await page.getByLabel('Source file, up to 128 KiB').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Local file evidence\n    code indentation'),
  });
  await page.getByRole('button', { name: 'Import source', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Owner text file/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Source format', exact: true }).selectOption('html');
  await page.getByLabel('Source title', { exact: true }).fill('Saved study page');
  await page.getByLabel('Source file, up to 128 KiB').setInputFiles({
    name: 'page.html',
    mimeType: 'text/html',
    buffer: Buffer.from(
      '<html><body><p>Saved page lesson.</p><pre>def f():\n    return 2</pre></body></html>',
    ),
  });
  await page.getByRole('button', { name: 'Import source', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Saved study page/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /Locators refer to extracted/ })).toBeVisible();
  await inspectLocalScreen(
    page,
    'source-import',
    page.locator('details').filter({
      has: page.getByText('Import notes or a local file', { exact: true }),
    }),
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);
  await page.getByLabel('Acceptance account').selectOption('other');
  await expect(
    page.getByRole('checkbox', { name: /Owner workshop notes|Owner text file|Saved study page/ }),
  ).toHaveCount(0);
});
