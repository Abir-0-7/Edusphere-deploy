import { afterEach, describe, expect, it, vi } from 'vitest';

describe('server instrumentation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does not prevent public routes from starting when optional service config is absent', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/studyvault');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_x');
    vi.stubEnv('AI_SERVICE_URL', 'http://localhost:8000');
    vi.stubEnv('AI_SERVICE_INTERNAL_TOKEN', 'ci-only-test');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const { register } = await import('../src/instrumentation');
    await expect(register()).resolves.toBeUndefined();
  });
});
