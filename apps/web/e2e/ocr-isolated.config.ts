import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const web = process.cwd();
const api = path.resolve(web, '..', 'ai-service');
const python =
  process.env.OCR_E2E_PYTHON ??
  (process.platform === 'win32' ? path.join(api, '.venv', 'Scripts', 'python.exe') : 'python');

export default defineConfig({
  testDir: '.',
  testMatch: 'ocr-isolated.spec.ts',
  workers: 1,
  timeout: 80_000,
  use: { baseURL: 'http://127.0.0.1:4345', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: `"${python}" -m uvicorn tests.full_course_browser_fixture:app --host 127.0.0.1 --port 4346`,
      cwd: api,
      url: 'http://127.0.0.1:4346/health',
      timeout: 120_000,
    },
    {
      command: 'pnpm exec vite --config e2e/ocr-vite.config.ts',
      cwd: web,
      url: 'http://127.0.0.1:4345',
      timeout: 120_000,
    },
  ],
});
