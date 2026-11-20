import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'cover-docx-isolated.spec.ts',
  fullyParallel: false,
  timeout: 120_000,
  outputDir: 'test-results/cover-docx-isolated',
  use: { baseURL: 'http://127.0.0.1:4324', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/cover-builder-vite.config.ts',
    url: 'http://127.0.0.1:4324',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
