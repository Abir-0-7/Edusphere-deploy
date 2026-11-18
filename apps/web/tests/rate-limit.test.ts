import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectiveDailyUsed, secondsUntilUtcMidnight, shouldResetDaily } from '../src/lib/quota-logic';
import { checkAiRateLimit, requireRedisConfig } from '../src/lib/rate-limit';

describe('daily quota reset boundary (task 1.11)', () => {
  it('resets the counter when quota_reset_date rolled to a new UTC day', () => {
    expect(shouldResetDaily('2025-01-02', '2025-01-01')).toBe(true);
    expect(effectiveDailyUsed('2025-01-02', '2025-01-01', 5)).toBe(0);
  });

  it('keeps the counter when the stored date is today', () => {
    expect(shouldResetDaily('2025-01-02', '2025-01-02')).toBe(false);
    expect(effectiveDailyUsed('2025-01-02', '2025-01-02', 5)).toBe(5);
  });

  it('treats a null stored date as a reset', () => {
    expect(effectiveDailyUsed('2025-01-02', null, 5)).toBe(0);
  });
});

describe('seconds until UTC midnight', () => {
  it('is positive and less than a day', () => {
    const s = secondsUntilUtcMidnight();
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(86400);
  });
});

describe('AI rate-limit Redis configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('requires both credentials before constructing the limiter', () => {
    expect(requireRedisConfig('https://example.upstash.io', 'token')).toEqual({
      url: 'https://example.upstash.io',
      token: 'token',
    });
    expect(() => requireRedisConfig(undefined, 'token')).toThrow(/Upstash is not configured/);
    expect(() => requireRedisConfig('https://example.upstash.io', undefined)).toThrow(
      /Upstash is not configured/,
    );
  });

  it('fails the AI request closed when Upstash is unavailable without taking down the app', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/studyvault');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_x');
    vi.stubEnv('AI_SERVICE_URL', 'http://localhost:8000');
    vi.stubEnv('AI_SERVICE_INTERNAL_TOKEN', 'test-only');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

    await expect(checkAiRateLimit('account')).resolves.toEqual({
      ok: false,
      reason: 'service_unavailable',
      retryAfterSeconds: 60,
    });
  });
});
