import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollUploadJobs } from '../src/app/(protected)/library/library-polling';
import type { JobStatus } from '../src/lib/ai-types';

const getToken = async () => 'session-token';
const parseId = '11111111-1111-4111-8111-111111111111';
const structureId = '22222222-2222-4222-8222-222222222222';
const embedId = '33333333-3333-4333-8333-333333333333';

function job(id: string, status: JobStatus['status'], nextJobId?: string): JobStatus {
  const kind = id === parseId ? 'parse_pdf' : id === structureId ? 'structure_chapters' : 'embed_chunks';
  return { id, kind, status, attempts: 1, result: nextJobId ? { next_job_id: nextJobId } : null };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PDF upload job chain', () => {
  it('opens the course after structuring while embeddings run separately', async () => {
    vi.useFakeTimers();
    const jobs = [
      job(parseId, 'done', structureId),
      job(structureId, 'running'),
      job(structureId, 'done', embedId),
    ];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(JSON.stringify(jobs.shift()), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    const update = vi.fn();
    const ready = vi.fn();
    const error = vi.fn();

    pollUploadJobs(getToken, parseId, update, ready, error, 10, 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
    expect(update.mock.calls.map(([value]) => value.id)).toEqual([parseId, structureId]);

    await vi.advanceTimersByTimeAsync(10);
    expect(fetch.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual([
      parseId,
      structureId,
      structureId,
    ]);
    expect(ready).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('suppresses updates and completion after cancellation while a request is in flight', async () => {
    let resolveFetch: (value: Response) => void = () => {
      throw new Error('Request has not started');
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const update = vi.fn();
    const ready = vi.fn();
    const error = vi.fn();
    const stop = pollUploadJobs(getToken, parseId, update, ready, error);
    await Promise.resolve();
    stop();
    resolveFetch(new Response(JSON.stringify(job(parseId, 'done')), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(update).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('reports downstream failure instead of marking a parsed PDF ready', async () => {
    vi.useFakeTimers();
    const jobs = [
      job(parseId, 'done', structureId),
      { ...job(structureId, 'failed'), error_reason: 'Chapter structuring failed' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(jobs.shift()), { status: 200 })),
    );
    const ready = vi.fn();
    const error = vi.fn();
    pollUploadJobs(getToken, parseId, vi.fn(), ready, error, 10, 1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(ready).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0].message).toBe('Chapter structuring failed');
  });

  it('ends the wait at the deadline even when a request never returns', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const ready = vi.fn();
    const error = vi.fn();
    pollUploadJobs(getToken, parseId, vi.fn(), ready, error, 10, 100);
    await vi.advanceTimersByTimeAsync(100);

    expect(ready).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0].message).toContain('still running');
  });

  it('rejects a repeated next job instead of polling a cycle forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(job(parseId, 'done', parseId)), { status: 200 })),
    );
    const ready = vi.fn();
    const error = vi.fn();
    pollUploadJobs(getToken, parseId, vi.fn(), ready, error);
    await vi.advanceTimersByTimeAsync(0);

    expect(ready).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0].message).toContain('repeated job');
  });
});
