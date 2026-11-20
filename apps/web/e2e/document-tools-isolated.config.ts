import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'document-tools-isolated.spec.ts',
  outputDir: '../test-results/document-tools-isolated',
  use: { baseURL: 'http://127.0.0.1:4347' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --config e2e/document-tools-vite.config.ts',
    url: 'http://127.0.0.1:4347',
    reuseExistingServer: !process.env.CI,
  },
});
