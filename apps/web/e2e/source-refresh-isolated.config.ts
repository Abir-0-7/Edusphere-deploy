import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const web = process.cwd();
const api = path.resolve(web, '..', 'ai-service');
const python =
  process.env.SOURCE_REFRESH_E2E_PYTHON ??
  (process.platform === 'win32' ? path.join(api, '.venv', 'Scripts', 'python.exe') : 'python');

export default defineConfig({
  testDir: '.',
  testMatch: 'source-refresh-isolated.spec.ts',
  fullyParallel: false,
  timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:4341', trace: 'retain-on-failure', actionTimeout: 15_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: `"${python}" -m uvicorn tests.source_refresh_browser_fixture:app --host 127.0.0.1 --port 4342`,
      cwd: api,
      url: 'http://127.0.0.1:4342/health',
      timeout: 120_000,
    },
    {
      command: 'pnpm exec vite --config e2e/source-refresh-vite.config.ts',
      cwd: web,
      url: 'http://127.0.0.1:4341',
      timeout: 120_000,
    },
  ],
});
