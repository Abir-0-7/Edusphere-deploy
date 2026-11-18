import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export interface DuelCard {
  id: string;
  prompt: string;
  answer: string;
}
export interface DuelPlayer {
  userId: string;
  score: number;
  answered: Set<string>;
}
export interface DuelState {
  id: string;
  status: 'waiting' | 'active' | 'finished';
  cards: DuelCard[];
  players: Map<string, DuelPlayer>;
  currentIndex: number;
  winner?: string;
  version: 1;
  deadlineAt: number | null;
  createdAt: number;
  settled: boolean;
  awards: Record<string, number>;
}

export const DuelCardInputSchema = z.object({
  id: z.string().min(1).max(128),
  prompt: z.string().min(1).max(2_000),
  answer: z.string().min(1).max(1_000),
});
export const DuelCreateInputSchema = z.object({ cards: z.array(DuelCardInputSchema).min(1).max(50) });
export const DuelJoinInputSchema = z.object({ duelId: z.string().uuid() }).strict();
export const DuelAnswerInputSchema = z
  .object({ duelId: z.string().uuid(), cardId: z.string().min(1).max(128), answer: z.string().max(1_000) })
  .strict();

export class DuelStore {
  private readonly duels = new Map<string, DuelState>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly questionMs = 30_000,
  ) {}

  create(cards: DuelCard[], hostUserId: string): DuelState {
    cards = DuelCreateInputSchema.parse({ cards }).cards;
    if (new Set(cards.map((card) => card.id)).size !== cards.length)
      throw new Error('duel card IDs must be unique');
    const id = randomUUID();
    const state: DuelState = {
      id,
      version: 1,
      status: 'waiting',
      cards: structuredClone(cards),
      players: new Map([[hostUserId, { userId: hostUserId, score: 0, answered: new Set() }]]),
      currentIndex: 0,
      deadlineAt: null,
      createdAt: this.now(),
      settled: false,
      awards: {},
    };
    this.duels.set(id, state);
    return state;
  }

  join(id: string, userId: string): DuelState {
    const state = this.require(id);
    if (state.players.has(userId)) throw new Error('already a duel member');
    if (state.status !== 'waiting' || state.players.size >= 2) throw new Error('duel is not joinable');
    state.players.set(userId, { userId, score: 0, answered: new Set() });
    state.status = 'active';
    state.deadlineAt = this.now() + this.questionMs;
    return state;
  }

  answer(id: string, userId: string, cardId: string, answer: string): { correct: boolean; state: DuelState } {
    const state = this.require(id);
    this.expire(state);
    const player = state.players.get(userId);
    if (!player || state.status !== 'active') throw new Error('not an active duel member');
    const card = state.cards.find((item) => item.id === cardId);
    if (!card || state.currentIndex >= state.cards.length || state.cards[state.currentIndex]?.id !== cardId)
      throw new Error('card is not current');
    if (player.answered.has(cardId)) throw new Error('card already answered');
    if (answer.length > 1_000) throw new Error('answer is too long');
    player.answered.add(cardId);
    const correct = normalize(answer) === normalize(card.answer);
    if (correct) player.score += 1;
    const bothAnswered = [...state.players.values()].every((entry) => entry.answered.has(cardId));
    if (bothAnswered) {
      this.advance(state, this.now());
    }
    return { correct, state };
  }

  get(id: string): DuelState | undefined {
    return this.duels.get(id);
  }
  require(id: string): DuelState {
    const state = this.get(id);
    if (!state) throw new Error('duel not found');
    return state;
  }
  forUser(userId: string): DuelState[] {
    return [...this.duels.values()].filter((state) => state.players.has(userId));
  }

  restore(state: DuelState): void {
    this.duels.set(state.id, state);
  }
  expire(state: DuelState): void {
    while (state.status === 'active' && state.deadlineAt !== null && this.now() >= state.deadlineAt)
      this.advance(state, state.deadlineAt);
    if (state.status === 'waiting' && this.now() >= state.createdAt + 300_000) state.status = 'finished';
  }
  private advance(state: DuelState, start: number): void {
    state.currentIndex += 1;
    state.deadlineAt = start + this.questionMs;
    if (state.currentIndex < state.cards.length) return;
    state.status = 'finished';
    state.deadlineAt = null;
    const players = [...state.players.values()].sort((a, b) => b.score - a.score);
    state.winner = players[0]?.score === players[1]?.score ? undefined : players[0]?.userId;
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const SavedDuelSchema = z.object({
  id: z.string().uuid(),
  version: z.literal(1),
  status: z.enum(['waiting', 'active', 'finished']),
  cards: z.array(DuelCardInputSchema).min(1).max(50),
  currentIndex: z.number().int().min(0).max(50),
  players: z
    .array(
      z.object({
        userId: z.string().min(1).max(128),
        score: z.number().int().min(0).max(50),
        answered: z.array(z.string().max(128)).max(50),
      }),
    )
    .min(1)
    .max(2),
  deadlineAt: z.number().nullable(),
  createdAt: z.number(),
  winner: z.string().optional(),
  settled: z.boolean(),
  awards: z.record(z.string(), z.number().int().min(0).max(3)),
});
export function saveDuel(state: DuelState) {
  return SavedDuelSchema.parse({
    ...state,
    players: [...state.players.values()].map((player) => ({ ...player, answered: [...player.answered] })),
  });
}
export function restoreDuel(raw: unknown): DuelState {
  const data = SavedDuelSchema.parse(raw);
  return {
    ...data,
    players: new Map(
      data.players.map((player) => [player.userId, { ...player, answered: new Set(player.answered) }]),
    ),
  };
}
export function publicDuel(state: DuelState) {
  return {
    id: state.id,
    version: state.version,
    status: state.status,
    cards: state.cards.map(({ id, prompt }) => ({ id, prompt })),
    players: [...state.players.values()].map(({ userId, score }) => ({
      userId,
      score,
      tokensAwarded: state.awards[userId] ?? 0,
    })),
    currentIndex: state.currentIndex,
    deadlineAt: state.deadlineAt,
    winner: state.winner,
  };
}
