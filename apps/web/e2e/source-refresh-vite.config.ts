import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/source-refresh', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../.tmp-playwright/f06/vite', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 4341,
    strictPort: true,
    proxy: {
      '/api/learning-service': {
        target: 'http://127.0.0.1:4342',
        rewrite: (path) => path.replace(/^\/api\/learning-service/, ''),
      },
    },
  },
  esbuild: { jsx: 'automatic' },
  css: { postcss: fileURLToPath(new URL('../postcss.config.mjs', import.meta.url)) },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://127.0.0.1:4342') },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      '@clerk/nextjs': fileURLToPath(new URL('./fixtures/course-candidates/clerk.ts', import.meta.url)),
    },
  },
});
