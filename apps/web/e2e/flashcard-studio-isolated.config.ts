import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'flashcard-studio-isolated.spec.ts',
  fullyParallel: false,
  timeout: 120_000,
  use: { baseURL: 'http://127.0.0.1:4332', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/flashcard-studio-vite.config.ts',
    url: 'http://127.0.0.1:4332',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
