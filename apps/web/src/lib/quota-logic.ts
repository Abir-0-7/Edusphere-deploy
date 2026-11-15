/**
 * Pure quota helpers (task 1.11) — no DB/Redis imports so unit tests load
 * without env. Used by rate-limit.ts and exercised directly in tests.
 */

/** Should the stored counter reset for a new UTC day? */
export function shouldResetDaily(today: string, stored: string | null): boolean {
  return stored !== today;
}

/** Counter value after applying the daily-reset rule. */
export function effectiveDailyUsed(today: string, stored: string | null, current: number): number {
  return shouldResetDaily(today, stored) ? 0 : current;
}

export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}
