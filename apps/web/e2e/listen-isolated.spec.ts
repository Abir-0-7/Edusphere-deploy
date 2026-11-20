import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const utterances: { text: string; rate: number; voice: string | undefined }[] = [];
    Object.defineProperty(window, 'testUtterances', { value: utterances });
    Object.defineProperty(window, 'speechSynthesis', {
      value: Object.assign(new EventTarget(), {
        getVoices: () => [{ voiceURI: 'test-local', name: 'Test speaker', lang: 'en-GB' }],
        speak: (utterance: SpeechSynthesisUtterance) => {
          utterances.push({ text: utterance.text, rate: utterance.rate, voice: utterance.voice?.voiceURI });
          window.setTimeout(() => utterance.onend?.call(utterance, {} as SpeechSynthesisEvent), 0);
        },
        cancel: () => undefined,
      }),
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        constructor(readonly text: string) {}
      },
    });
  });
});

test('speaks rendered summary text using the selected browser voice and speed', async ({ page }) => {
  const summary =
    'Leaves use light **energy** to make sugars. ' +
    'This is part of the explanation. '.repeat(30) +
    'The end.';
  await page.route('**/summary?level=standard', (route) => route.fulfill({ json: { content: summary } }));

  await page.goto('/');
  const listen = page.getByRole('button', { name: 'Listen to summary' });
  await expect(listen).toBeEnabled();
  await page.getByLabel('Voice').selectOption('browser:test-local');
  await page.getByLabel('Speed').selectOption('1.25');
  await listen.click();
  await expect(listen).toBeEnabled();

  const utterances = await page.evaluate(
    () =>
      (window as unknown as Window & { testUtterances?: { text: string; rate: number; voice: string }[] })
        .testUtterances ?? [],
  );
  expect(utterances.length).toBeGreaterThan(1);
  expect(utterances.map(({ text }) => text).join(' ')).toBe(summary.replaceAll('**', ''));
  expect(utterances.every(({ rate, voice }) => rate === 1.25 && voice === 'test-local')).toBe(true);
});

test('falls back to a browser voice after the selected online voice fails', async ({ page }) => {
  const summary = 'Leaves use light energy to make sugars.';
  await page.route('**/summary?level=standard', (route) => route.fulfill({ json: { content: summary } }));
  await page.route('**/api/tts/stream', (route) => route.fulfill({ status: 503 }));

  await page.goto('/');
  const listen = page.getByRole('button', { name: 'Listen to summary' });
  await expect(listen).toBeEnabled();
  await page.getByLabel('Voice').selectOption('en-GB-SoniaNeural');
  const request = page.waitForRequest('**/api/tts/stream');
  await listen.click();
  expect((await request).postDataJSON()).toEqual({ text: summary, voice: 'en-GB-SoniaNeural' });
  await expect(listen).toBeEnabled();
  const utterances = await page.evaluate(
    () =>
      (window as unknown as Window & { testUtterances?: { text: string; voice: string }[] }).testUtterances ??
      [],
  );
  expect(utterances).toEqual([{ text: summary, voice: 'test-local', rate: 1 }]);
});

test('stops browser narration when the summary level changes', async ({ page }) => {
  await page.route('**/summary?level=*', (route) =>
    route.fulfill({ json: { content: 'A complete saved explanation.' } }),
  );
  await page.goto('/');
  await page.getByLabel('Voice').selectOption('browser:test-local');
  await page.evaluate(() => {
    const scope = window as unknown as Window & { cancelledNarration?: number };
    scope.cancelledNarration = 0;
    window.speechSynthesis.speak = () => undefined;
    window.speechSynthesis.cancel = () => {
      scope.cancelledNarration = (scope.cancelledNarration ?? 0) + 1;
    };
  });
  await page.getByRole('button', { name: 'Listen to summary' }).click();
  await expect(page.getByRole('button', { name: 'Stop audio' })).toBeVisible();
  await page.locator('input[type="range"]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: 'Listen to summary' })).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Window & { cancelledNarration?: number }).cancelledNarration ?? 0,
      ),
    )
    .toBeGreaterThan(0);
});
