import { describe, expect, it } from 'vitest';
import { DuelStore } from '../src/duel.js';

describe('server authoritative duel', () => {
  it('requires both players and scores only correct answers', () => {
    const store = new DuelStore();
    const state = store.create([{ id: 'c1', prompt: '2+2', answer: '4' }], 'a');
    store.join(state.id, 'b');
    expect(store.answer(state.id, 'a', 'c1', '4').correct).toBe(true);
    expect(store.answer(state.id, 'b', 'c1', 'wrong').correct).toBe(false);
    expect(store.require(state.id).status).toBe('finished');
    expect(store.require(state.id).winner).toBe('a');
  });
  it('rejects answers from non-members', () => {
    const store = new DuelStore(); const state = store.create([{ id: 'c', prompt: 'q', answer: 'a' }], 'a'); store.join(state.id, 'b');
    expect(() => store.answer(state.id, 'x', 'c', 'a')).toThrow('not an active duel member');
  });
  it('rejects duplicate card ids and prevents a second answer per card', () => {
    const store = new DuelStore();
    expect(() => store.create([{ id: 'x', prompt: 'q', answer: 'a' }, { id: 'x', prompt: 'q2', answer: 'a2' }], 'a')).toThrow('unique');
    const state = store.create([{ id: 'c', prompt: 'q', answer: 'a' }], 'a');
    store.join(state.id, 'b');
    store.answer(state.id, 'a', 'c', 'a');
    expect(() => store.answer(state.id, 'a', 'c', 'a')).toThrow('already answered');
    expect(state.players.get('a')?.score).toBe(1);
  });
  it('allows an authenticated member to resume and enumerate active duels', () => {
    const store = new DuelStore();
    const state = store.create([{ id: 'c', prompt: 'q', answer: 'a' }], 'a');
    store.join(state.id, 'b');
    expect(store.forUser('a')).toHaveLength(1);
    expect(store.forUser('outsider')).toHaveLength(0);
  });
});
