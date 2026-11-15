import { Redis } from '@upstash/redis';

export interface Match { id: string; players: string[] }
export interface MatchmakingStore {
  enqueue(userId: string): Promise<void>;
  dequeue(): Promise<string | undefined>;
  remove(userId: string): Promise<void>;
}

export class MemoryMatchmaking implements MatchmakingStore {
  private queue: string[] = [];
  async enqueue(userId: string): Promise<void> { if (!this.queue.includes(userId)) this.queue.push(userId); }
  async dequeue(): Promise<string | undefined> { return this.queue.shift(); }
  async remove(userId: string): Promise<void> { this.queue = this.queue.filter((queued) => queued !== userId); }
}

export class UpstashMatchmaking implements MatchmakingStore {
  constructor(private readonly redis: Redis, private readonly key = 'studyvault:matchmaking') {}
  async enqueue(userId: string): Promise<void> {
    await this.redis.lrem(this.key, 0, userId);
    await this.redis.rpush(this.key, userId);
    await this.redis.expire(this.key, 300);
  }
  async dequeue(): Promise<string | undefined> { const value = await this.redis.lpop<string>(this.key); return value ?? undefined; }
  async remove(userId: string): Promise<void> { await this.redis.lrem(this.key, 0, userId); }
}

export class Matchmaker {
  private readonly joining = new Map<string, Promise<Match | undefined>>();
  constructor(private readonly store: MatchmakingStore) {}

  join(userId: string): Promise<Match | undefined> {
    const existing = this.joining.get(userId);
    if (existing) return existing;
    const operation = this.performJoin(userId).finally(() => this.joining.delete(userId));
    this.joining.set(userId, operation);
    return operation;
  }

  async leave(userId: string): Promise<void> { await this.store.remove(userId); }

  private async performJoin(userId: string): Promise<Match | undefined> {
    for (let attempts = 0; attempts < 8; attempts += 1) {
      const opponent = await this.store.dequeue();
      if (!opponent) { await this.store.enqueue(userId); return undefined; }
      if (opponent === userId) continue;
      return { id: [opponent, userId].sort().join(':'), players: [opponent, userId] };
    }
    await this.store.enqueue(userId);
    return undefined;
  }
}
