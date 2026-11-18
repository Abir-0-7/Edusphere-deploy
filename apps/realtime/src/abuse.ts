import type postgres from 'postgres';

export interface EventLimiter {
  take(userId: string): Promise<boolean>;
}

/** Bounded test/local limiter. Production persists the same account budget. */
export class MemoryEventLimiter implements EventLimiter {
  private readonly windows = new Map<string, { minute: number; count: number }>();
  constructor(
    private readonly limit = 120,
    private readonly now: () => number = Date.now,
    private readonly maxAccounts = 1000,
  ) {}
  async take(userId: string): Promise<boolean> {
    const minute = Math.floor(this.now() / 60000);
    for (const [key, row] of this.windows) if (row.minute !== minute) this.windows.delete(key);
    const row = this.windows.get(userId);
    if (!row && this.windows.size >= this.maxAccounts) return false;
    const next = { minute, count: Math.min(this.limit + 1, (row?.count ?? 0) + 1) };
    this.windows.set(userId, next);
    return next.count <= this.limit;
  }
}

export class PostgresEventLimiter implements EventLimiter {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly limit = 120,
  ) {}
  async take(clerkId: string): Promise<boolean> {
    // Exactly one bounded counter per account. A process restart/reconnect cannot
    // reset the budget; deleting the owner cascades its counter.
    const [row] = await this.sql<{ count: number }[]>`
      INSERT INTO realtime_event_limits (user_id, minute, count)
      SELECT id, date_trunc('minute', now()), 1 FROM users WHERE clerk_id = ${clerkId}
      ON CONFLICT (user_id) DO UPDATE SET
        count = CASE WHEN realtime_event_limits.minute = excluded.minute
          THEN least(realtime_event_limits.count + 1, ${this.limit + 1}) ELSE 1 END,
        minute = excluded.minute
      RETURNING count`;
    return row !== undefined && row.count <= this.limit;
  }
}
