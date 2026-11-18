import { describe, expect, it } from 'vitest';
import { DurableDuels, MemoryDuelRepository } from '../src/duel-repository.js';
import { publicDuel } from '../src/duel.js';

const cards = [{ id: 'one', prompt: 'What is one plus one?', answer: '2' }];

describe('durable duel transactions and recovery', () => {
  it('serializes duplicate and simultaneous answers, then pays once across restarts', async () => {
    const repository = new MemoryDuelRepository();
    const service = new DurableDuels(repository);
    const duel = await service.create(cards, 'host');
    await service.join(duel.id, 'guest');
    const results = await Promise.allSettled([
      service.answer(duel.id, 'host', 'one', '2'),
      service.answer(duel.id, 'host', 'one', '2'),
      service.answer(duel.id, 'guest', 'one', '2'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const restarted = new DurableDuels(repository);
    const finished = await restarted.resume(duel.id, 'host');
    expect(finished.status).toBe('finished');
    expect([...finished.players.values()].map((player) => player.score)).toEqual([1, 1]);
    await Promise.all([restarted.resume(duel.id, 'host'), restarted.resume(duel.id, 'guest')]);
    expect([...repository.rewards.values()]).toEqual([1, 1]);
  });

  it('caps repeat duel rewards per account/day and does not rewrite an existing award', async () => {
    const now = () => Date.UTC(2026, 10, 18);
    const repository = new MemoryDuelRepository(now);
    const service = new DurableDuels(repository, now);
    const first = await service.create(cards, 'host');
    await service.join(first.id, 'guest');
    await service.answer(first.id, 'host', 'one', '2');
    await service.answer(first.id, 'guest', 'one', 'wrong');
    const second = await service.create([...cards, { id: 'two', prompt: 'Three?', answer: '3' }], 'host');
    await service.join(second.id, 'guest');
    for (const [id, answer] of [
      ['one', '2'],
      ['two', '3'],
    ]) {
      await service.answer(second.id, 'host', id!, answer!);
      await service.answer(second.id, 'guest', id!, 'wrong');
    }
    expect((await service.resume(second.id, 'host')).awards.host).toBe(0);
    expect(repository.rewards.get('host:2026-11-18')).toBe(1);
  });

  it('bounds source/card/account scope, expires old rooms, and hides every answer key', async () => {
    let now = Date.UTC(2026, 10, 18);
    const repository = new MemoryDuelRepository(() => now, 1);
    const service = new DurableDuels(repository, () => now, 1000);
    const duel = await service.create(cards, 'host');
    await expect(service.create(cards, 'host')).rejects.toThrow('capacity');
    await service.join(duel.id, 'guest');
    await expect(service.resume(duel.id, 'stranger')).rejects.toThrow('member');
    await expect(service.answer(duel.id, 'host', 'not-current', '2')).rejects.toThrow('current');
    expect(publicDuel(await service.resume(duel.id, 'host')).cards[0]).toEqual({
      id: 'one',
      prompt: 'What is one plus one?',
    });
    now += 1001;
    await expect(service.answer(duel.id, 'host', 'one', '2')).rejects.toThrow('not an active');
    expect((await service.resume(duel.id, 'host')).status).toBe('finished');
    expect(repository.rewards.size).toBe(0);
    now += 86400000;
    await expect(service.resume(duel.id, 'host')).rejects.toThrow('not found');
    await expect(service.create(cards, 'host')).resolves.toHaveProperty('id');
  });

  it('rejects a third member and bounds a guest participating in many rooms', async () => {
    const repository = new MemoryDuelRepository(Date.now, 1);
    const service = new DurableDuels(repository);
    const one = await service.create(cards, 'a');
    const two = await service.create(cards, 'b');
    await service.join(one.id, 'guest');
    await expect(service.join(one.id, 'third')).rejects.toThrow('member');
    await expect(service.join(two.id, 'guest')).rejects.toThrow('capacity');
  });
});
