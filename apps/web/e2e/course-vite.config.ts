import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/course-candidates', import.meta.url)),
  server: { host: '127.0.0.1', port: 4324, strictPort: true },
  esbuild: { jsx: 'automatic' },
  css: { postcss: fileURLToPath(new URL('../postcss.config.mjs', import.meta.url)) },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://127.0.0.1:4325') },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      '@clerk/nextjs': fileURLToPath(new URL('./fixtures/course-candidates/clerk.ts', import.meta.url)),
    },
  },
});
