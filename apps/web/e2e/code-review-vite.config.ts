import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/code-review', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../.tmp-playwright/code-review/vite', import.meta.url)),
  server: { host: '127.0.0.1', port: 4343, strictPort: true },
  esbuild: { jsx: 'automatic' },
  css: { postcss: fileURLToPath(new URL('../postcss.config.mjs', import.meta.url)) },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://localhost:8000') },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      '@studyvault/types': fileURLToPath(new URL('../../../packages/types/src/index.ts', import.meta.url)),
    },
  },
});
