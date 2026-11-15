import { describe, expect, it } from 'vitest';
import { createTokenVerifier } from '../src/auth.js';

describe('auth', () => {
  it('supports explicit dev mode only', async () => {
    const verify = createTokenVerifier({ jwksUrl: 'http://invalid', devMode: true });
    await expect(verify('user_123')).resolves.toMatchObject({ id: 'user_123' });
    await expect(verify('')).rejects.toThrow();
  });
});
