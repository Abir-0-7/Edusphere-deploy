/**
 * Per-user AI rate limiting + daily quota (task 1.11).
 *
 * Two layers, both keyed on the authenticated user's id:
 *   - sliding per-minute limit via Upstash Ratelimit (transport-level),
 *   - daily quota counter in `users.daily_ai_quota_used` (UTC-reset).
 *
 * Limits come from env (config over hard-coding). Exceeding either returns a
 * 429 body in the shared error shape with a retry hint. Pure boundary logic
 * lives in quota-logic.ts for unit tests.
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { sql } from 'drizzle-orm';
import { getEnv } from '@/env';
import { getDb } from '@/lib/db';
import { effectiveDailyUsed, secondsUntilUtcMidnight } from '@/lib/quota-logic';

let _minuteLimiter: Ratelimit | undefined;
let _redis: Redis | undefined;

function redis() {
  const config = requireRedisConfig(getEnv().UPSTASH_REDIS_REST_URL, getEnv().UPSTASH_REDIS_REST_TOKEN);
  _redis ??= new Redis(config);
  return _redis;
}

function minuteLimiter() {
  _minuteLimiter ??= new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(getEnv().AI_RATE_LIMIT_PER_MIN, '1 m'),
    prefix: 'rl:ai:min',
  });
  return _minuteLimiter;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds?: number;
  reason?: 'minute_limit' | 'daily_quota' | 'service_unavailable';
}

export function requireRedisConfig(url: string | undefined, token: string | undefined) {
  if (!url || !token) throw new Error('AI rate limiting is unavailable because Upstash is not configured.');
  return { url, token };
}

/** Check the per-minute window first, then the daily quota (UTC). */
export async function checkAiRateLimit(clerkId: string): Promise<RateLimitResult> {
  let minute: Awaited<ReturnType<ReturnType<typeof minuteLimiter>['limit']>>;
  try {
    minute = await minuteLimiter().limit(clerkId);
  } catch (error) {
    console.error('AI rate limiting unavailable', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return { ok: false, reason: 'service_unavailable', retryAfterSeconds: 60 };
  }
  if (!minute.success) {
    return {
      ok: false,
      reason: 'minute_limit',
      retryAfterSeconds: Math.max(1, Math.ceil((minute.reset - Date.now()) / 1000)),
    };
  }
  return checkDailyQuota(clerkId);
}

async function checkDailyQuota(clerkId: string): Promise<RateLimitResult> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  // Atomic: reset the counter if the stored date rolled over, then compare.
  const rows = await db.execute<{ daily_ai_quota_used: number }>(sql`
    UPDATE users
    SET daily_ai_quota_used = ${0},
        quota_reset_date = ${today}
    WHERE clerk_id = ${clerkId} AND (quota_reset_date <> ${today} OR quota_reset_date IS NULL)
    RETURNING daily_ai_quota_used
  `);
  if (rows.length === 0) {
    // Either the row didn't need resetting, or no user row exists yet.
    const cur = await db.execute<{ daily_ai_quota_used: number }>(sql`
      SELECT daily_ai_quota_used FROM users WHERE clerk_id = ${clerkId}
    `);
    const used = effectiveDailyUsed(today, today, cur[0]?.daily_ai_quota_used ?? 0);
    return used >= getEnv().AI_DAILY_LIMIT
      ? { ok: false, reason: 'daily_quota', retryAfterSeconds: secondsUntilUtcMidnight() }
      : { ok: true };
  }
  return { ok: true }; // counter was reset to 0 for the new day
}

/** Increment the daily counter after a successful AI call. */
export async function consumeAiQuota(clerkId: string): Promise<void> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  await db.execute(sql`
    UPDATE users
    SET daily_ai_quota_used = daily_ai_quota_used + 1, quota_reset_date = ${today}
    WHERE clerk_id = ${clerkId}
  `);
}
