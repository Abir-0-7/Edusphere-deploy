import { AiHttpError, getJob } from '@/lib/ai-client';
import type { JobStatus } from '@/lib/ai-types';

type GetToken = () => Promise<string | null>;

/** Wait for chapters, then let search indexing finish in the background. */
export function pollUploadJobs(
  getToken: GetToken,
  firstJobId: string,
  onUpdate: (job: JobStatus) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
  intervalMs = 1500,
  timeoutMs = 180_000,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let lastError: Error | undefined;
  const request = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const visited = new Set([firstJobId]);
  const timeout = setTimeout(() => {
    stopped = true;
    request.abort();
    clearTimeout(timer);
    wake?.();
    onError(lastError ?? new Error('PDF processing is still running. Refresh the library in a moment.'));
  }, timeoutMs);

  const fail = (error: Error) => {
    stopped = true;
    clearTimeout(timeout);
    onError(error);
  };

  const pause = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    });

  void (async () => {
    let currentJobId = firstJobId;
    while (!stopped && Date.now() < deadline) {
      let job: JobStatus;
      try {
        job = await getJob(getToken, currentJobId, request.signal);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Could not check PDF processing');
        if (error instanceof AiHttpError && [401, 403, 404].includes(error.status) && !stopped) {
          fail(error);
          return;
        }
        if (!stopped) await pause();
        continue;
      }
      if (stopped) return;
      lastError = undefined;
      onUpdate(job);
      if (job.status === 'failed' || job.status === 'cancelled') {
        fail(new Error(job.error_reason || 'PDF processing failed. Check the file and try again.'));
        return;
      }
      if (job.status === 'done') {
        const nextJobId = typeof job.result?.next_job_id === 'string' ? job.result.next_job_id : '';
        if (job.kind === 'structure_chapters' || !nextJobId) {
          stopped = true;
          clearTimeout(timeout);
          onComplete();
          return;
        }
        if (visited.has(nextJobId)) {
          fail(new Error('PDF processing returned a repeated job. Refresh the library and try again.'));
          return;
        }
        visited.add(nextJobId);
        currentJobId = nextJobId;
        continue;
      }
      await pause();
    }
    if (!stopped)
      fail(lastError ?? new Error('PDF processing is still running. Refresh the library in a moment.'));
  })();

  return () => {
    stopped = true;
    request.abort();
    clearTimeout(timer);
    clearTimeout(timeout);
    wake?.();
  };
}
