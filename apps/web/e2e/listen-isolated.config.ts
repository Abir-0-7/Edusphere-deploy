import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'listen-isolated.spec.ts',
  outputDir: '../test-results/listen-isolated',
  use: { baseURL: 'http://127.0.0.1:4334' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/listen-vite.config.ts',
    url: 'http://127.0.0.1:4334',
    reuseExistingServer: !process.env.CI,
  },
});
