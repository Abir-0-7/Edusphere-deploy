import { z } from 'zod';

/**
 * Typed env validation (task 1.6): the app fails fast at startup with a clear
 * message when a required variable is missing. Call `getEnv()` in server code
 * only; `src/instrumentation.ts` triggers validation when the server boots.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  CLERK_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().optional(),
  AI_SERVICE_URL: z.string().url(),
  AI_SERVICE_INTERNAL_TOKEN: z.string().min(1),
  JUDGE0_BASE_URL: z.string().url().optional(),
  JUDGE0_API_KEY: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  // Clerk redirects; sensible defaults for local dev.
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().default('/sign-in'),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().default('/sign-up'),
  NEXT_PUBLIC_STUDYVAULT_EXTENSION_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^[a-p]{32}$/, 'must be a 32-character Chrome extension ID').optional(),
  ),
  // AI usage limits (task 1.11).
  AI_DAILY_LIMIT: z.coerce.number().int().positive().default(30),
  AI_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${missing}\nCheck .env against .env.example.`);
  }
  return parsed.data;
}

let cached: Env | undefined;

/** Cached accessor; validates on first call (server startup). */
export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  cached ??= loadEnv(source);
  return cached;
}
