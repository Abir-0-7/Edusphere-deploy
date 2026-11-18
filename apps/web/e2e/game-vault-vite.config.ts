import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/game-vault', import.meta.url)),
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  server: { host: '127.0.0.1', port: 4317, strictPort: true },
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://localhost:8000') },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      '@clerk/nextjs': fileURLToPath(new URL('./fixtures/game-vault/clerk.ts', import.meta.url)),
    },
  },
});
