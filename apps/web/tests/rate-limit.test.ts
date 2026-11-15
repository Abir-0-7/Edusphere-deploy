import { describe, expect, it } from 'vitest';
import { effectiveDailyUsed, secondsUntilUtcMidnight, shouldResetDaily } from '../src/lib/quota-logic';

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
