import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'tools-responsive-isolated.spec.ts',
  workers: 1,
  timeout: 120_000,
  outputDir: '../test-results/tools-responsive',
  use: { baseURL: 'http://127.0.0.1:4357', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/tools-responsive-vite.config.ts',
    url: 'http://127.0.0.1:4357',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
