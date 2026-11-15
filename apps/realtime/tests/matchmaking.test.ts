import { describe, expect, it } from 'vitest';
import { Matchmaker, MemoryMatchmaking } from '../src/matchmaking.js';

describe('matchmaking queue', () => {
  it('matches distinct users and removes a user on leave', async () => {
    const store = new MemoryMatchmaking();
    const maker = new Matchmaker(store);
    await expect(maker.join('a')).resolves.toBeUndefined();
    const match = await maker.join('b');
    expect(match?.players).toEqual(['a', 'b']);
    await maker.join('c');
    await maker.leave('c');
    expect(await store.dequeue()).toBeUndefined();
  });
  it('does not match a user with their own queued session', async () => {
    const maker = new Matchmaker(new MemoryMatchmaking());
    await maker.join('same');
    await expect(maker.join('same')).resolves.toBeUndefined();
    await expect(maker.join('other')).resolves.toMatchObject({ players: ['same', 'other'] });
  });
  it('deduplicates concurrent queue requests for the same user', async () => {
    const maker = new Matchmaker(new MemoryMatchmaking());
    await Promise.all([maker.join('a'), maker.join('a')]);
    await expect(maker.join('b')).resolves.toMatchObject({ players: ['a', 'b'] });
  });
});
