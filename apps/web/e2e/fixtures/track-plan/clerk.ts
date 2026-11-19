import type { GetToken } from '../../../src/lib/ai-client';

export function fixtureGetToken(): GetToken {
  return async () => `track-fixture-${localStorage.getItem('track-fixture-user') ?? 'missing'}`;
}
