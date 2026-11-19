import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const web = process.cwd();
const api = path.resolve(web, '..', 'ai-service');
const python =
  process.env.COURSE_GENERATION_E2E_PYTHON ??
  (process.platform === 'win32' ? path.join(api, '.venv', 'Scripts', 'python.exe') : 'python');

export default defineConfig({
  testDir: '.',
  testMatch: 'course-generation-isolated.spec.ts',
  fullyParallel: false,
  timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:4335', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: `"${python}" -m uvicorn tests.course_generation_browser_fixture:app --host 127.0.0.1 --port 4336`,
      cwd: api,
      url: 'http://127.0.0.1:4336/health',
      timeout: 120_000,
    },
    {
      command: 'pnpm exec vite --config e2e/course-generation-vite.config.ts',
      cwd: web,
      url: 'http://127.0.0.1:4335',
      timeout: 120_000,
    },
  ],
});
