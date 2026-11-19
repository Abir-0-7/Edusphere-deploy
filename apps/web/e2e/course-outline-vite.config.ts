import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/course-outline', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../.tmp-playwright/course-outline/vite', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 4333,
    strictPort: true,
    proxy: {
      '/api/learning-service': {
        target: 'http://127.0.0.1:4334',
        rewrite: (path) => path.replace(/^\/api\/learning-service/, ''),
      },
    },
  },
  esbuild: { jsx: 'automatic' },
  css: { postcss: fileURLToPath(new URL('../postcss.config.mjs', import.meta.url)) },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://127.0.0.1:4334') },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
});
