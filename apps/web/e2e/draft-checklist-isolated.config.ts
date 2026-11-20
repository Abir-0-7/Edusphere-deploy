import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'draft-checklist-isolated.spec.ts',
  outputDir: 'test-results/draft-checklist',
  fullyParallel: false,
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4350', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/draft-checklist-vite.config.ts',
    url: 'http://127.0.0.1:4350',
    reuseExistingServer: false,
  },
});
