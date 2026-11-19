import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'offline-deck-isolated.spec.ts',
  fullyParallel: false,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4333', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/offline-deck-vite.config.ts',
    url: 'http://127.0.0.1:4333',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
