import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'bibliography-isolated.spec.ts',
  fullyParallel: false,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4326', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/bibliography-vite.config.ts',
    url: 'http://127.0.0.1:4326',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
