import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const web = path.resolve(process.cwd());
const api = path.resolve(web, '..', 'ai-service');
const python = process.env.COURSE_E2E_PYTHON ?? 'python';

export default defineConfig({
  testDir: '.',
  testMatch: 'course.spec.ts',
  timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:4324', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: '"' + python + '" -m uvicorn tests.course_browser_fixture:app --host 127.0.0.1 --port 4325',
      cwd: api,
      url: 'http://127.0.0.1:4325/health',
    },
    {
      command: 'pnpm exec vite --config e2e/course-vite.config.ts',
      cwd: web,
      url: 'http://127.0.0.1:4324',
    },
  ],
});
