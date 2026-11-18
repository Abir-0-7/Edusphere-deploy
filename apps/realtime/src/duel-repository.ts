import type postgres from 'postgres';
import { DuelStore, restoreDuel, saveDuel, type DuelCard, type DuelState } from './duel.js';

export interface DuelRepository {
  create(state: DuelState): Promise<void>;
  change<T>(
    id: string,
    userId: string,
    joining: boolean,
    update: (state: DuelState) => T,
  ): Promise<{ value: T; state: DuelState }>;
}

export class MemoryDuelRepository implements DuelRepository {
  private readonly rows = new Map<string, ReturnType<typeof saveDuel>>();
  readonly rewards = new Map<string, number>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxPerUser = 20,
  ) {}
  async create(state: DuelState): Promise<void> {
    for (const [id, saved] of this.rows) if (saved.createdAt + 86_400_000 <= this.now()) this.rows.delete(id);
    const owner = [...state.players.keys()][0];
    const count = [...this.rows.values()].filter((row) =>
      row.players.some((player) => player.userId === owner),
    ).length;
    if (count >= this.maxPerUser) throw new Error('duel capacity reached');
    this.rows.set(state.id, saveDuel(state));
  }
  async change<T>(
    id: string,
    userId: string,
    joining: boolean,
    update: (state: DuelState) => T,
  ): Promise<{ value: T; state: DuelState }> {
    const saved = this.rows.get(id);
    if (!saved || saved.createdAt + 86_400_000 <= this.now()) throw new Error('duel not found');
    const state = restoreDuel(saved);
    authorize(state, userId, joining);
    if (joining && !state.players.has(userId)) {
      const count = [...this.rows.values()].filter(
        (row) =>
          row.createdAt + 86_400_000 > this.now() && row.players.some((player) => player.userId === userId),
      ).length;
      if (count >= this.maxPerUser) throw new Error('duel capacity reached');
    }
    const value = update(state);
    if (state.status === 'finished' && !state.settled) {
      for (const player of state.players.values()) {
        const key = `${player.userId}:${new Date(this.now()).toISOString().slice(0, 10)}`;
        const amount = Math.min(3, player.score);
        state.awards[player.userId] = this.rewards.has(key) ? 0 : amount;
        if (amount && !this.rewards.has(key)) this.rewards.set(key, amount);
      }
      state.settled = true;
    }
    this.rows.set(id, saveDuel(state));
    return { value, state };
  }
}

export class PostgresDuelRepository implements DuelRepository {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly maxPerUser = 20,
  ) {}
  async create(state: DuelState): Promise<void> {
    await this.sql.begin(async (tx) => {
      const owner = [...state.players.keys()][0]!;
      const [user] = await tx<{ id: string }[]>`SELECT id FROM users WHERE clerk_id = ${owner} FOR UPDATE`;
      if (!user) throw new Error('user not found');
      await tx`DELETE FROM realtime_duels WHERE user_id = ${user.id} AND expires_at <= now()`;
      const [count] = await tx<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM realtime_duels WHERE (user_id = ${user.id} OR opponent_user_id = ${user.id}) AND expires_at > now()`;
      if ((count?.count ?? 0) >= this.maxPerUser) throw new Error('duel capacity reached');
      // Key-share locks prevent a deleted card being copied back into a saved duel.
      const ids = state.cards.map((card) => card.id);
      const sources = await tx<
        { id: string }[]
      >`SELECT id FROM flashcards WHERE user_id = ${user.id} AND id = ANY(${ids}::uuid[]) FOR KEY SHARE`;
      if (sources.length !== ids.length) throw new Error('flashcards not found');
      await tx`INSERT INTO realtime_duels (id, user_id, state) VALUES (${state.id}, ${user.id}, ${tx.json(saveDuel(state))})`;
    });
  }
  async change<T>(
    id: string,
    userId: string,
    joining: boolean,
    update: (state: DuelState) => T,
  ): Promise<{ value: T; state: DuelState }> {
    return this.sql.begin(async (tx) => {
      const [user] = joining
        ? await tx<{ id: string }[]>`SELECT id FROM users WHERE clerk_id = ${userId} FOR UPDATE`
        : await tx<{ id: string }[]>`SELECT id FROM users WHERE clerk_id = ${userId} FOR KEY SHARE`;
      if (!user) throw new Error('user not found');
      const [row] = await tx<{ state: unknown }[]>`SELECT state FROM realtime_duels
        WHERE id = ${id} AND expires_at > now() AND (${joining} OR user_id = ${user.id} OR opponent_user_id = ${user.id}) FOR UPDATE`;
      if (!row) throw new Error('duel not found');
      const state = restoreDuel(row.state);
      authorize(state, userId, joining);
      if (joining && !state.players.has(userId)) {
        const [count] = await tx<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM realtime_duels WHERE (user_id = ${user.id} OR opponent_user_id = ${user.id}) AND expires_at > now()`;
        if ((count?.count ?? 0) >= this.maxPerUser) throw new Error('duel capacity reached');
      }
      const value = update(state);
      if (state.status === 'finished' && !state.settled) {
        for (const player of state.players.values()) {
          const amount = Math.min(3, player.score);
          state.awards[player.userId] = 0;
          if (!amount) continue;
          // A per-account/day ledger key caps all duel payouts, including concurrent finishes.
          const [reward] = await tx<
            { amount: number }[]
          >`INSERT INTO token_ledger (user_id, amount, reason, ref_id)
            SELECT id, ${amount}, 'duel:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), id FROM users WHERE clerk_id = ${player.userId}
            ON CONFLICT (reason, ref_id) DO NOTHING RETURNING amount`;
          state.awards[player.userId] = reward?.amount ?? 0;
        }
        state.settled = true;
      }
      await tx`UPDATE realtime_duels SET state = ${tx.json(saveDuel(state))},
        opponent_user_id = CASE WHEN ${joining} THEN ${user.id}::uuid ELSE opponent_user_id END, updated_at = now() WHERE id = ${id}`;
      return { value, state };
    });
  }
}

function authorize(state: DuelState, userId: string, joining: boolean): void {
  if (!state.players.has(userId) && !(joining && state.status === 'waiting' && state.players.size === 1))
    throw new Error('not a duel member');
}

export class DurableDuels {
  constructor(
    private readonly repository: DuelRepository,
    private readonly now: () => number = Date.now,
    private readonly questionMs = 30_000,
  ) {}
  async create(cards: DuelCard[], userId: string): Promise<DuelState> {
    const state = new DuelStore(this.now, this.questionMs).create(cards, userId);
    await this.repository.create(state);
    return state;
  }
  async join(id: string, userId: string): Promise<DuelState> {
    const { state } = await this.repository.change(id, userId, true, (state) => {
      const engine = this.engine(state);
      engine.expire(state);
      engine.join(id, userId);
    });
    return state;
  }
  async resume(id: string, userId: string): Promise<DuelState> {
    const { state } = await this.repository.change(id, userId, false, (state) =>
      this.engine(state).expire(state),
    );
    return state;
  }
  async answer(
    id: string,
    userId: string,
    cardId: string,
    answer: string,
  ): Promise<{ correct: boolean; state: DuelState }> {
    // Commit deadline recovery separately, so a rejected late answer cannot roll it back.
    await this.resume(id, userId);
    const result = await this.repository.change(
      id,
      userId,
      false,
      (state) => this.engine(state).answer(id, userId, cardId, answer).correct,
    );
    return { correct: result.value, state: result.state };
  }
  private engine(state: DuelState): DuelStore {
    const engine = new DuelStore(this.now, this.questionMs);
    engine.restore(state);
    return engine;
  }
}
