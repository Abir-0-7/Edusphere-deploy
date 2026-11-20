import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/ocr', import.meta.url)),
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../.tmp-playwright/ocr/vite', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 4345,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4346',
        rewrite: (path) => path.replace(/^\/api\/learning-service/, ''),
      },
    },
  },
  esbuild: { jsx: 'automatic' },
  css: { postcss: fileURLToPath(new URL('../postcss.config.mjs', import.meta.url)) },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('') },
  optimizeDeps: { include: ['tesseract.js'] },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
});
