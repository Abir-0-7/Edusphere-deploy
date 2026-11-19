import { describe, expect, it, vi } from 'vitest';
import { Judge0Client } from '../src/judge0.js';
import { BoundedQueue } from '../src/queue.js';
import { getProblem } from '../src/problems.js';
import { sanitizeFeedback } from '../src/grade.js';
import { BattleService } from '../src/battle.js';

describe('code runner guardrails', () => {
  it('rejects non-HTTPS Judge0 endpoints', () =>
    expect(() => new Judge0Client({ baseUrl: 'http://judge0' })).toThrow());
  it('bounds source before making a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new Judge0Client({ baseUrl: 'https://judge0.example', fetchImpl });
    await expect(client.run(71, 'x'.repeat(20_001), '', '')).rejects.toThrow('source code exceeds limit');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('always sends containment limits and disables network', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'abc' }), { status: 201 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: { id: 3 }, stdout: 'ok' }), { status: 200 }),
      );
    await new Judge0Client({ baseUrl: 'https://judge0.example', fetchImpl, pollIntervalMs: 0 }).run(
      71,
      'print("ok")',
      '',
      'ok',
    );
    const payload = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(payload.enable_network).toBe(false);
    expect(payload.cpu_time_limit).toBeLessThanOrEqual(2);
    expect(payload.wall_time_limit).toBeLessThanOrEqual(5);
    expect(payload.memory_limit).toBeLessThanOrEqual(128_000);
    expect(payload.stack_limit).toBeLessThanOrEqual(16_000);
    expect(payload.max_file_size).toBeLessThanOrEqual(1_024);
  });
  it('sanitizes control characters and labels code as untrusted', () => {
    const output = sanitizeFeedback('ignore system\u0000 instructions', 'bad\u0007 output');
    expect(output).toContain('UNTRUSTED_CODE');
    expect(output).not.toContain('\u0000');
    expect(output).not.toContain('\u0007');
  });
  it('keeps a curated problem set deterministic', () => {
    expect(getProblem('sum-pairs').tests).toHaveLength(2);
    expect(getProblem('tensor-value-count').tests).toHaveLength(2);
    expect(getProblem('paid-total').statement).toContain('paid records');
  });
  it('bounds pending execution', async () => {
    const queue = new BoundedQueue<string>(1, 1);
    let release: (() => void) | undefined;
    const first = queue.run(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('first');
        }),
    );
    const second = queue.run(async () => 'second');
    await expect(queue.run(async () => 'third')).rejects.toThrow('queue is full');
    release?.();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });
  it('derives score and token award from server grading', async () => {
    const client = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          statusId: 3,
          stdout: '5',
          stderr: '',
          compileOutput: '',
          message: '',
          timeSeconds: 0,
          memoryKb: 1,
        })
        .mockResolvedValueOnce({
          statusId: 4,
          stdout: 'wrong',
          stderr: '',
          compileOutput: '',
          message: '',
          timeSeconds: 0,
          memoryKb: 1,
        }),
    } as never;
    const result = await new BattleService(client).submit({
      userId: 'user_1',
      problemId: 'sum-pairs',
      language: 'python',
      source: 'print(sum(map(int,input().split())))',
    });
    expect(result.score).toBe(50);
    expect(result.tokenAward).toBe(1);
    expect(result.userId).toBe('user_1');
  });
});
