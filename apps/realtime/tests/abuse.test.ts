import { describe, expect, it } from 'vitest';
import { MemoryEventLimiter } from '../src/abuse.js';
import { realtimeSettings } from '../src/settings.js';

describe('bounded realtime admission', () => {
  it('admits only the configured number under concurrent account requests and resets after a minute', async () => {
    let now = 0;
    const limiter = new MemoryEventLimiter(5, () => now, 1);
    expect(
      (await Promise.all(Array.from({ length: 20 }, () => limiter.take('same')))).filter(Boolean),
    ).toHaveLength(5);
    expect(await limiter.take('other')).toBe(false);
    now = 60000;
    expect(await limiter.take('other')).toBe(true);
  });
  it('validates deployment limits rather than accepting unbounded or malformed values', () => {
    expect(realtimeSettings({}).REALTIME_EVENT_MAX_PAYLOAD_BYTES).toBe(16384);
    expect(() => realtimeSettings({ REALTIME_MAX_QUEUE: '10000000' })).toThrow();
    expect(() => realtimeSettings({ REALTIME_QUESTION_MS: 'NaN' })).toThrow();
    expect(() => realtimeSettings({ REALTIME_EVENT_LIMIT_PER_MINUTE: '0' })).toThrow();
  });
});
