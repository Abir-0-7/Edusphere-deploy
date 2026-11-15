import { describe, expect, it } from 'vitest';
import { initialSm2State, sm2Review } from '../src/sm2';

describe('SM-2', () => {
  it('good grades grow the interval 1 -> 6 -> ~15', () => {
    let s = initialSm2State();
    s = sm2Review(s, 4);
    expect(s.intervalDays).toBe(1);
    s = sm2Review(s, 4);
    expect(s.intervalDays).toBe(6);
    s = sm2Review(s, 4);
    // 6 * EF; EF stays 2.5 at q=4 first adjusts to 2.5? q=4: EF + (0.1 - 0.1) = EF
    expect(s.intervalDays).toBe(Math.round(6 * s.easeFactor));
    expect(s.intervalDays).toBeGreaterThan(10);
  });

  it('easy grade increases ease factor', () => {
    const s = sm2Review(initialSm2State(), 5);
    expect(s.easeFactor).toBeCloseTo(2.6, 2);
  });

  it('hard grade lowers ease factor and interval growth slows', () => {
    let s = initialSm2State();
    s = sm2Review(s, 4); // EF 2.5
    const before = s.easeFactor;
    s = sm2Review(s, 3); // hard
    expect(s.easeFactor).toBeLessThan(before);
  });

  it('again (q<3) resets repetitions and interval, floors ease at 1.3', () => {
    let s = initialSm2State();
    s = sm2Review(s, 5); // EF 2.6, interval 1
    s = sm2Review(s, 5);
    s = sm2Review(s, 0); // lapse
    expect(s.repetitions).toBe(0);
    expect(s.intervalDays).toBe(0);
    for (let i = 0; i < 10; i++) {
      s = sm2Review(s, 0);
      expect(s.easeFactor).toBeGreaterThanOrEqual(1.3);
    }
    expect(s.easeFactor).toBe(1.3);
  });

  it('rejects invalid grades', () => {
    expect(() => sm2Review(initialSm2State(), 6)).toThrow(RangeError);
    expect(() => sm2Review(initialSm2State(), -1)).toThrow(RangeError);
    expect(() => sm2Review(initialSm2State(), 2.5 as never)).toThrow(RangeError);
  });
});
