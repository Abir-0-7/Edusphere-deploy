import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/course-generation', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../.tmp-playwright/f04/vite', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 4335,
    strictPort: true,
    proxy: {
      '/api/learning-service': {
        target: 'http://127.0.0.1:4336',
        rewrite: (path) => path.replace(/^\/api\/learning-service/, ''),
      },
    },
  },
  esbuild: { jsx: 'automatic' },
  css: { postcss: fileURLToPath(new URL('../postcss.config.mjs', import.meta.url)) },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://127.0.0.1:4336') },
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
});
