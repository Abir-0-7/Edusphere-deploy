import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/tools-responsive', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../.tmp-playwright/tools-responsive/vite', import.meta.url)),
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  server: { host: '127.0.0.1', port: 4357, strictPort: true },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://localhost:8000') },
  esbuild: { jsx: 'automatic' },
  css: { postcss: fileURLToPath(new URL('../postcss.config.mjs', import.meta.url)) },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      '@studyvault/types': fileURLToPath(new URL('../../../packages/types/src/index.ts', import.meta.url)),
      '@clerk/nextjs': fileURLToPath(new URL('./fixtures/whiteboard/clerk-stub.ts', import.meta.url)),
    },
  },
});
