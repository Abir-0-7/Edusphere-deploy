import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/schema.ts',
    './src/game-schema.ts',
    './src/bibliography-schema.ts',
    './src/source-schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/studyvault' },
});
