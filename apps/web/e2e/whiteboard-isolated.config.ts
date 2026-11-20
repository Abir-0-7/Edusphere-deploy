import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'whiteboard-isolated.spec.ts',
  outputDir: 'test-results/whiteboard',
  fullyParallel: false,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4331', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/whiteboard-vite.config.ts',
    url: 'http://127.0.0.1:4331',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
