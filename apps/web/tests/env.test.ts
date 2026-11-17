import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';

const VALID = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  CLERK_SECRET_KEY: 'sk_test_x',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x',
  AI_SERVICE_URL: 'http://localhost:8000',
  AI_SERVICE_INTERNAL_TOKEN: 't',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 't',
};

describe('typed env validation', () => {
  it('rejects local demo configuration in production', () => {
    expect(() => loadEnv({ ...VALID, NODE_ENV: 'production', EDUSPHERE_LOCAL_DEMO: 'true' })).toThrow(
      /development-only/,
    );
    expect(() => loadEnv({ ...VALID, NODE_ENV: 'development', EDUSPHERE_LOCAL_DEMO: 'true' })).not.toThrow();
  });
  it('accepts a complete environment', () => {
    expect(() => loadEnv(VALID)).not.toThrow();
  });

  it('fails fast with a clear message when variables are missing', () => {
    try {
      loadEnv({});
      expect.unreachable('expected throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('Invalid environment configuration');
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('CLERK_SECRET_KEY');
    }
  });

  it('rejects malformed values (non-URL DATABASE_URL)', () => {
    expect(() => loadEnv({ ...VALID, DATABASE_URL: 'not-a-url' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('accepts an omitted extension ID but rejects malformed configured IDs', () => {
    expect(() => loadEnv({ ...VALID, NEXT_PUBLIC_STUDYVAULT_EXTENSION_ID: 'a'.repeat(32) })).not.toThrow();
    expect(() => loadEnv({ ...VALID, NEXT_PUBLIC_STUDYVAULT_EXTENSION_ID: 'not-an-extension-id' })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
