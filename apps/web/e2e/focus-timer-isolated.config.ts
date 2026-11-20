import { defineConfig, devices } from '@playwright/test';

// Renders the real timer/provider with deterministic HTTP and Clerk fixtures.
export default defineConfig({
  testDir: '.',
  testMatch: 'focus-timer-isolated.spec.ts',
  fullyParallel: false,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4342', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/focus-timer-vite.config.ts',
    url: 'http://127.0.0.1:4342',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
