import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (task 2.13): upload -> chapters -> chat -> review.
 *
 * Auth note: Clerk sign-in is a hosted third-party flow. The learning-loop spec
 * needs a Clerk testing token; without one, the suite checks anonymous guard
 * rails only. See e2e/README.md for setup instructions.
 *
 * CI uses an explicit IPv4 listener and URL. GitHub's Ubuntu runner has
 * intermittently failed to resolve localhost from Chromium even when the
 * Playwright readiness probe succeeds. Local development keeps localhost.
 */
const BASE_URL = process.env.CI ? 'http://127.0.0.1:3000' : 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/game-vault-isolated.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? BASE_URL,
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // CI runs the production build made by the preceding workflow step;
        // dev-with-turbopack is for local iteration only.
        command: process.env.CI ? 'pnpm exec next start' : 'pnpm exec next dev --turbopack',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
