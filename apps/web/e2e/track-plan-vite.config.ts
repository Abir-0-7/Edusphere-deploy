import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/track-plan', import.meta.url)),
  server: {
    host: '127.0.0.1', port: 4324, strictPort: true,
    proxy: {
      '/api/learning-service': {
        target: 'http://127.0.0.1:4325',
        rewrite: (path) => path.replace(/^\/api\/learning-service/, ''),
      },
    },
  },
  esbuild: { jsx: 'automatic' },
  css: { postcss: fileURLToPath(new URL('../postcss.config.mjs', import.meta.url)) },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://127.0.0.1:4325') },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
});
