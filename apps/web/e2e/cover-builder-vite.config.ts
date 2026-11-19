import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/cover-builder', import.meta.url)),
  server: { host: '127.0.0.1', port: 4324, strictPort: true },
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      '@studyvault/types': fileURLToPath(
        new URL('../../../packages/types/src/cover-api.ts', import.meta.url),
      ),
    },
  },
});
