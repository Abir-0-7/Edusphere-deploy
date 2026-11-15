import { describe, expect, it } from 'vitest';
import { hasSameOrigin } from '../src/lib/request-origin';

describe('hasSameOrigin', () => {
  const url = 'https://studyvault.example/api/account';

  it('allows requests whose Origin matches the request URL', () => {
    expect(hasSameOrigin(new Request(url, { headers: { origin: 'https://studyvault.example' } }))).toBe(true);
  });

  it('rejects cross-origin, missing, and malformed Origin headers', () => {
    expect(hasSameOrigin(new Request(url, { headers: { origin: 'https://attacker.example' } }))).toBe(false);
    expect(hasSameOrigin(new Request(url))).toBe(false);
    expect(hasSameOrigin(new Request(url, { headers: { origin: 'not-an-origin' } }))).toBe(false);
  });
});
