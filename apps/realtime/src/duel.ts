import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export interface DuelCard { id: string; prompt: string; answer: string }
export interface DuelPlayer { userId: string; score: number; answered: Set<string> }
export interface DuelState {
  id: string; status: 'waiting' | 'active' | 'finished'; cards: DuelCard[];
  players: Map<string, DuelPlayer>; currentIndex: number; winner?: string;
}

export const DuelCardInputSchema = z.object({ id: z.string().min(1).max(128), prompt: z.string().min(1).max(2_000), answer: z.string().min(1).max(1_000) });
export const DuelCreateInputSchema = z.object({ cards: z.array(DuelCardInputSchema).min(1).max(50) });
export const DuelJoinInputSchema = z.object({ duelId: z.string().uuid() });
export const DuelAnswerInputSchema = z.object({ duelId: z.string().uuid(), cardId: z.string().min(1).max(128), answer: z.string().max(1_000) });

export class DuelStore {
  private readonly duels = new Map<string, DuelState>();

  create(cards: DuelCard[], hostUserId: string): DuelState {
    if (cards.length === 0 || cards.length > 50) throw new Error('duel requires 1-50 cards');
    if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error('duel card IDs must be unique');
    const id = randomUUID();
    const state: DuelState = { id, status: 'waiting', cards: structuredClone(cards), players: new Map([[hostUserId, { userId: hostUserId, score: 0, answered: new Set() }]]), currentIndex: 0 };
    this.duels.set(id, state);
    return state;
  }

  join(id: string, userId: string): DuelState {
    const state = this.require(id);
    if (state.players.has(userId)) throw new Error('already a duel member');
    if (state.status !== 'waiting' || state.players.size >= 2) throw new Error('duel is not joinable');
    state.players.set(userId, { userId, score: 0, answered: new Set() });
    state.status = 'active';
    return state;
  }

  answer(id: string, userId: string, cardId: string, answer: string): { correct: boolean; state: DuelState } {
    const state = this.require(id);
    const player = state.players.get(userId);
    if (!player || state.status !== 'active') throw new Error('not an active duel member');
    const card = state.cards.find((item) => item.id === cardId);
    if (!card || state.currentIndex >= state.cards.length || state.cards[state.currentIndex]?.id !== cardId) throw new Error('card is not current');
    if (player.answered.has(cardId)) throw new Error('card already answered');
    player.answered.add(cardId);
    if (answer.length > 1_000) throw new Error('answer is too long');
    const correct = normalize(answer) === normalize(card.answer);
    if (correct) player.score += 1;
    const bothAnswered = [...state.players.values()].every((entry) => entry.answered.has(cardId));
    if (bothAnswered) {
      state.currentIndex += 1;
      if (state.currentIndex >= state.cards.length) {
        state.status = 'finished';
        const players = [...state.players.values()].sort((a, b) => b.score - a.score);
        state.winner = players[0]?.score === players[1]?.score ? undefined : players[0]?.userId;
      }
    }
    return { correct, state };
  }

  get(id: string): DuelState | undefined { return this.duels.get(id); }
  require(id: string): DuelState { const state = this.get(id); if (!state) throw new Error('duel not found'); return state; }
  forUser(userId: string): DuelState[] { return [...this.duels.values()].filter((state) => state.players.has(userId)); }
}

function normalize(value: string): string { return value.trim().toLocaleLowerCase(); }
