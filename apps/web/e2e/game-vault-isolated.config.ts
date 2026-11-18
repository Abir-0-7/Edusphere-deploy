import { defineConfig, devices } from '@playwright/test';

// Exercises the actual React player with HTTP fixtures; production Clerk guards
// are unaffected. Signed-in storage coverage is a separate deployment gate.
export default defineConfig({
  testDir: '.',
  testMatch: 'game-vault-isolated.spec.ts',
  outputDir: '../test-results/game-vault',
  fullyParallel: false,
  timeout: 120_000,
  use: { baseURL: 'http://127.0.0.1:4317', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/game-vault-vite.config.ts',
    url: 'http://127.0.0.1:4317',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
