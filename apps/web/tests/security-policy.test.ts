import { describe, expect, it } from 'vitest';
import { getContentSecurityPolicyDirectives } from '../src/lib/security-policy';

describe('getContentSecurityPolicyDirectives', () => {
  it('allows same-origin server proxies and the configured AI service origin in connect-src', () => {
    expect(getContentSecurityPolicyDirectives('https://api.studyvault.example/v1')['connect-src']).toEqual([
      "'self'",
      'https://api.studyvault.example',
    ]);
  });

  it('rejects an invalid AI service URL', () => {
    expect(() => getContentSecurityPolicyDirectives('not a URL')).toThrow();
  });
});
