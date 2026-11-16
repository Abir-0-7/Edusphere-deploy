import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollJob, uploadPdf } from '../src/lib/ai-client';
import type { JobStatus } from '../src/lib/ai-types';

const token = vi.fn(async () => 'test-token');

function job(status: JobStatus['status'], attempts = 1): JobStatus {
  return { id: 'job-1', kind: 'parse_pdf', status, attempts, error_reason: null, result: null };
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
    const fetch = vi.fn(async () => new Response(JSON.stringify(states.shift() ?? job('done')), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const updates: JobStatus['status'][] = [];
    const onError = vi.fn();

    pollJob(token, 'job-1', (value) => updates.push(value.status), 1, 100, onError);
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

    pollJob(token, 'job-1', (value) => updates.push(value), 1, 100);
    await vi.advanceTimersByTimeAsync(0);

    expect(updates).toEqual([failed]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a timeout or last poll error instead of failing silently', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(job('running')), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const onError = vi.fn();

    pollJob(token, 'job-1', () => undefined, 1, 8, onError);
    await vi.advanceTimersByTimeAsync(7);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[0].message).toBe('job polling timed out');
  });
});

describe('uploadPdf', () => {
  it('returns both identifiers needed to follow the parse job', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ job_id: '11111111-1111-4111-8111-111111111111', document_id: '22222222-2222-4222-8222-222222222222' }),
      { status: 202 },
    )));
    const result = await uploadPdf(token, new File(['%PDF-1.4'], 'lecture.pdf', { type: 'application/pdf' }));
    expect(result).toEqual({ jobId: '11111111-1111-4111-8111-111111111111', documentId: '22222222-2222-4222-8222-222222222222' });
  });
});
