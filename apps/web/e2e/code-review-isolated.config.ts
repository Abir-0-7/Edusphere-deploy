import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'code-review-isolated.spec.ts',
  outputDir: 'test-results/code-review',
  fullyParallel: false,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4343', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/code-review-vite.config.ts',
    url: 'http://127.0.0.1:4343',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
