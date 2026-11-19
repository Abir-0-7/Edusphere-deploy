import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./fixtures/map', import.meta.url)),
  server: { host: '127.0.0.1', port: 4334, strictPort: true },
  define: { 'process.env.NEXT_PUBLIC_AI_SERVICE_URL': JSON.stringify('http://localhost:8000') },
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    '@': fileURLToPath(new URL('../src', import.meta.url)),
    '@clerk/nextjs': fileURLToPath(new URL('./fixtures/map/clerk.ts', import.meta.url)),
    'next/navigation': fileURLToPath(new URL('./fixtures/map/navigation.ts', import.meta.url)),
    'next/link': fileURLToPath(new URL('./fixtures/map/link.tsx', import.meta.url)),
  } },
});
