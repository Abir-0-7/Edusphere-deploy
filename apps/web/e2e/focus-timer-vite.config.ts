import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/focus-timer', import.meta.url)),
  server: { host: '127.0.0.1', port: 4342, strictPort: true },
  define: {
    'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://localhost:8000'),
    'process.env.NEXT_PUBLIC_STUDYVAULT_EXTENSION_ID': JSON.stringify(''),
  },
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      '@clerk/nextjs': fileURLToPath(new URL('./fixtures/focus-timer/clerk.ts', import.meta.url)),
    },
  },
});
