import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/flashcard-studio', import.meta.url)),
  server: { host: '127.0.0.1', port: 4332, strictPort: true },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://localhost:8000') },
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
});
