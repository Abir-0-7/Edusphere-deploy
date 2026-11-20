import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/document-tools', import.meta.url)),
  server: { host: '127.0.0.1', port: 4347, strictPort: true },
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      '@clerk/nextjs': fileURLToPath(new URL('./fixtures/document-tools/clerk.ts', import.meta.url)),
    },
  },
});
