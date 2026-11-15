import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionBuild = path.join(extensionRoot, 'dist');
const playwrightModule = path.resolve(extensionRoot, '../web/node_modules/@playwright/test/index.mjs');
process.env.TEMP = extensionRoot;
process.env.TMP = extensionRoot;
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const sessionId = '7504d84c-ec6a-4bd7-8cd6-3f69b3ea72c6';
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Focus message test</title><p>StudyVault messaging test</p>');
});
const profile = await mkdtemp(path.join(extensionRoot, '.smoke-profile-'));
let context;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object', 'test server did not bind');
const pageOrigin = `http://127.0.0.1:${address.port}`;
const senderUrl = `${pageOrigin}/focus`;

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionBuild}`,
      `--load-extension=${extensionBuild}`,
      '--host-resolver-rules=MAP localhost 127.0.0.1',
      '--no-first-run',
    ],
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  assert(extensionId.length > 0, 'extension service worker did not start');

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
  await popup.locator('#domain-input').fill('localhost');
  await popup.getByRole('button', { name: 'Add' }).click();
  await popup.getByText('localhost', { exact: true }).waitFor();

  const page = await context.newPage();
  await page.goto(senderUrl);
  const startResult = await page.evaluate(({ extensionId, sessionId }) => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(extensionId, {
        type: 'studyvault.focus-session.v1',
        version: 1,
        sessionId,
        active: true,
        expectedEndAt: new Date(Date.now() + 60_000).toISOString(),
        sentAt: Date.now(),
      }, resolve);
      setTimeout(() => reject(new Error('focus-start message timed out')), 5000);
    });
  }, { extensionId, sessionId });
  assert(startResult?.ok && startResult.locked, 'focus start did not activate the lock');

  await popup.reload();
  await popup.getByText(/Blocklist locked until/).waitFor();
  assert(await popup.locator('#domain-input').isDisabled(), 'blocklist editor stayed enabled during focus');
  const mutationResult = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ version: 1, type: 'studyvault.extension.add-domain.v1', domain: 'example.net' }),
  );
  assert(!mutationResult?.ok && mutationResult.error === 'blocklist-locked', 'service worker accepted a blocklist edit during focus');

  let blocked = false;
  try {
    await page.goto(`http://localhost:${address.port}/blocked`, { timeout: 5000 });
  } catch (error) {
    blocked = String(error).includes('ERR_BLOCKED_BY_CLIENT');
  }
  assert(blocked, 'listed main-frame navigation was not blocked during focus');

  const completionPage = await context.newPage();
  await completionPage.goto(senderUrl);
  const endResult = await completionPage.evaluate(({ extensionId, sessionId }) => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(extensionId, {
        type: 'studyvault.focus-session.v1',
        version: 1,
        sessionId,
        active: false,
        expectedEndAt: null,
        sentAt: Date.now(),
      }, resolve);
      setTimeout(() => reject(new Error('focus-end message timed out')), 5000);
    });
  }, { extensionId, sessionId });
  assert(endResult?.ok && !endResult.locked, 'focus completion did not clear the lock');

  const unblockedResponse = await completionPage.goto(`http://localhost:${address.port}/unblocked`);
  assert(unblockedResponse?.ok() && (await completionPage.title()) === 'Focus message test', 'navigation remained blocked after session completion');
  console.log('MV3 smoke passed: focus message locks the list, blocks navigation, then unlocks navigation.');
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
