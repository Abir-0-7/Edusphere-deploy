/**
 * SM-2 spaced repetition (task 2.12). Pure, server-authoritative, unit tested.
 * Reference: SuperMemo SM-2 (https://www.supermemo.com/en/archives1992-2020/english/ol/sm2).
 */

export interface Sm2State {
  /** easiness factor, >= 1.3 */
  easeFactor: number;
  /** current inter-repetition interval in days (0 = never reviewed) */
  intervalDays: number;
  /** count of consecutive successful (q >= 3) repetitions */
  repetitions: number;
}

export interface Sm2Result extends Sm2State {
  /** days until next review */
  dueInDays: number;
}

export function initialSm2State(): Sm2State {
  return { easeFactor: 2.5, intervalDays: 0, repetitions: 0 };
}

/**
 * quality: 0–5 SM-2 grade. 0/1/2 = fail (again), 3 = hard, 4 = good, 5 = easy.
 */
export function sm2Review(state: Sm2State, quality: number): Sm2Result {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new RangeError('quality must be an integer 0..5');
  }

  let { easeFactor, intervalDays, repetitions } = state;

  if (quality < 3) {
    // Failed: reset the repetition counter and interval; ease still adjusts.
    repetitions = 0;
    intervalDays = 0; // review again today/next session
  } else {
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    repetitions += 1;
  }

  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), floored at 1.3
  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easeFactor < 1.3) {
    easeFactor = 1.3;
  }

  return { easeFactor: round2(easeFactor), intervalDays, repetitions, dueInDays: intervalDays };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
