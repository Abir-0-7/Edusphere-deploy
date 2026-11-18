import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';

export interface Match {
  id: string;
  players: string[];
}
export interface MatchmakingStore {
  join(userId: string): Promise<Match | undefined>;
  remove(userId: string): Promise<void>;
}

export class MemoryMatchmaking implements MatchmakingStore {
  private readonly queue = new Map<string, number>();
  private readonly matches = new Map<string, { match: Match; expires: number }>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxQueue = 100,
  ) {}
  async join(userId: string): Promise<Match | undefined> {
    this.prune();
    const previous = this.matches.get(userId);
    if (previous) return previous.match;
    const opponent = [...this.queue.keys()].find((queued) => queued !== userId);
    if (!opponent) {
      if (!this.queue.has(userId) && this.queue.size >= this.maxQueue)
        throw new Error('matchmaking capacity reached');
      this.queue.set(userId, this.now() + 300_000);
      return undefined;
    }
    this.queue.delete(opponent);
    this.queue.delete(userId);
    const match = { id: randomUUID(), players: [opponent, userId] };
    for (const player of match.players) this.matches.set(player, { match, expires: this.now() + 300_000 });
    return match;
  }
  async remove(userId: string): Promise<void> {
    this.queue.delete(userId);
  }
  async dequeue(): Promise<string | undefined> {
    this.prune();
    const first = this.queue.keys().next().value;
    if (first) this.queue.delete(first);
    return first;
  }
  private prune(): void {
    for (const [id, expires] of this.queue) if (expires <= this.now()) this.queue.delete(id);
    for (const [id, entry] of this.matches) if (entry.expires <= this.now()) this.matches.delete(id);
  }
}

export class PostgresMatchmaking implements MatchmakingStore {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly maxQueue = 100,
  ) {}
  async join(clerkId: string): Promise<Match | undefined> {
    return this.sql.begin(async (tx) => {
      // Serialize the bounded queue across realtime processes.
      await tx`SELECT pg_advisory_xact_lock(802110)`;
      const [user] = await tx<
        { id: string }[]
      >`SELECT id FROM users WHERE clerk_id = ${clerkId} FOR KEY SHARE`;
      if (!user) throw new Error('user not found');
      await tx`DELETE FROM realtime_matchmaking WHERE expires_at <= now()`;
      const [existing] = await tx<{ match_id: string | null; opponent_user_id: string | null }[]>`
        SELECT match_id, opponent_user_id FROM realtime_matchmaking WHERE user_id = ${user.id}`;
      if (existing?.match_id && existing.opponent_user_id) {
        const [opponent] = await tx<
          { clerk_id: string }[]
        >`SELECT clerk_id FROM users WHERE id = ${existing.opponent_user_id}`;
        if (!opponent) throw new Error('opponent not found');
        return { id: existing.match_id, players: [clerkId, opponent.clerk_id] };
      }
      const [opponent] = await tx<{ user_id: string; clerk_id: string }[]>`
        SELECT q.user_id, u.clerk_id FROM realtime_matchmaking q JOIN users u ON u.id = q.user_id
        WHERE q.user_id <> ${user.id} AND q.match_id IS NULL ORDER BY q.created_at, q.user_id LIMIT 1 FOR UPDATE OF q`;
      if (!opponent) {
        const [count] = await tx<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM realtime_matchmaking`;
        if (!existing && (count?.count ?? 0) >= this.maxQueue)
          throw new Error('matchmaking capacity reached');
        await tx`INSERT INTO realtime_matchmaking (user_id) VALUES (${user.id})
          ON CONFLICT (user_id) DO UPDATE SET expires_at = now() + interval '5 minutes'`;
        return undefined;
      }
      const id = randomUUID();
      await tx`UPDATE realtime_matchmaking SET match_id = ${id}, opponent_user_id = ${user.id}, expires_at = now() + interval '5 minutes'
        WHERE user_id = ${opponent.user_id}`;
      await tx`INSERT INTO realtime_matchmaking (user_id, match_id, opponent_user_id)
        VALUES (${user.id}, ${id}, ${opponent.user_id}) ON CONFLICT (user_id)
        DO UPDATE SET match_id = excluded.match_id, opponent_user_id = excluded.opponent_user_id, expires_at = excluded.expires_at`;
      return { id, players: [opponent.clerk_id, clerkId] };
    });
  }
  async remove(clerkId: string): Promise<void> {
    await this
      .sql`DELETE FROM realtime_matchmaking WHERE user_id = (SELECT id FROM users WHERE clerk_id = ${clerkId}) AND match_id IS NULL`;
  }
}

export class Matchmaker {
  constructor(private readonly store: MatchmakingStore) {}
  join(userId: string): Promise<Match | undefined> {
    return this.store.join(userId);
  }
  leave(userId: string): Promise<void> {
    return this.store.remove(userId);
  }
}
