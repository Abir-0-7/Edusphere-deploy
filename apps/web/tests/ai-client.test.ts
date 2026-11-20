import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollJob, uploadPdf } from '../src/lib/ai-client';
import type { JobStatus } from '../src/lib/ai-types';

const token = vi.fn(async () => 'test-token');

function job(status: JobStatus['status'], attempts = 1): JobStatus {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'parse_pdf',
    status,
    attempts,
    error_reason: null,
    result: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pollJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('reports pending and running states until a job is done', async () => {
    const states = [job('pending'), job('running', 2), job('done', 2)];
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(states.shift() ?? job('done')), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch);
    const updates: JobStatus['status'][] = [];
    const onError = vi.fn();

    pollJob(
      token,
      '11111111-1111-4111-8111-111111111111',
      (value) => updates.push(value.status),
      1,
      100,
      onError,
    );
    await vi.advanceTimersByTimeAsync(2);

    expect(updates).toEqual(['pending', 'running', 'done']);
    expect(onError).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stops on a failed job and preserves the server error state', async () => {
    const failed = { ...job('failed', 3), error_reason: 'encrypted PDF' };
    const fetch = vi.fn(async () => new Response(JSON.stringify(failed), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const updates: JobStatus[] = [];

    pollJob(token, '11111111-1111-4111-8111-111111111111', (value) => updates.push(value), 1, 100);
    await vi.advanceTimersByTimeAsync(0);

    expect(updates).toEqual([failed]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a timeout or last poll error instead of failing silently', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(job('running')), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const onError = vi.fn();

    pollJob(token, '11111111-1111-4111-8111-111111111111', () => undefined, 1, 8, onError);
    await vi.advanceTimersByTimeAsync(7);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[0].message).toBe('job polling timed out');
  });

  it('aborts a stalled request at the polling deadline', async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>(() => {});
      }),
    );
    const onUpdate = vi.fn();
    const onError = vi.fn();
    pollJob(token, '11111111-1111-4111-8111-111111111111', onUpdate, 1, 8, onError);
    await vi.advanceTimersByTimeAsync(8);

    expect(signal?.aborted).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'job polling timed out' }),
    );
  });

  it('reaches the deadline even after response headers arrive but the body stalls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new ReadableStream(), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const onUpdate = vi.fn();
    const onError = vi.fn();
    pollJob(token, '11111111-1111-4111-8111-111111111111', onUpdate, 1, 8, onError);
    await vi.advanceTimersByTimeAsync(8);

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('stopping aborts the request and ignores a response that arrives later', async () => {
    let signal: AbortSignal | null | undefined;
    let respond: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>((resolve) => {
          respond = resolve;
        });
      }),
    );
    const onUpdate = vi.fn();
    const onError = vi.fn();
    const stop = pollJob(token, '11111111-1111-4111-8111-111111111111', onUpdate, 1, 8, onError);
    await vi.advanceTimersByTimeAsync(0);

    stop();
    respond(new Response(JSON.stringify(job('done')), { status: 200 }));
    await vi.advanceTimersByTimeAsync(20);

    expect(signal?.aborted).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ends on an unavailable job immediately and preserves the owner-safe service error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'not_found', message: 'job not found' },
            }),
            { status: 404 },
          ),
      ),
    );
    const onError = vi.fn();
    const onUpdate = vi.fn();
    pollJob(token, '11111111-1111-4111-8111-111111111111', onUpdate, 1, 100, onError);
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 404, message: 'job not found' }),
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('uploadPdf', () => {
  it('returns both identifiers needed to follow the parse job', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              job_id: '11111111-1111-4111-8111-111111111111',
              document_id: '22222222-2222-4222-8222-222222222222',
            }),
            { status: 202 },
          ),
      ),
    );
    const result = await uploadPdf(token, new File(['%PDF-1.4'], 'lecture.pdf', { type: 'application/pdf' }));
    expect(result).toEqual({
      jobId: '11111111-1111-4111-8111-111111111111',
      documentId: '22222222-2222-4222-8222-222222222222',
    });
  });
});
