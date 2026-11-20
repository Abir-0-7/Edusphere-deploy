import { maxDocxXmlBytes } from './ocr-docx-limits';

/** Decompress privately in a disposable worker so cancellation also stops CPU work. */
export function readDocxXml(file: File, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./ocr-docx-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      reject(new Error('The Word document reader could not start. Try again.'));
      return;
    }
    let settled = false;
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    function finish(error?: Error, xml?: Uint8Array) {
      if (settled) return;
      settled = true;
      worker.terminate();
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(xml!);
    }
    const timeout = setTimeout(
      () => finish(new Error('Opening this Word document took too long. Try a smaller file.')),
      45_000,
    );
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () =>
      finish(new Error('Could not read this Word document. Save a new .docx and retry.'));
    worker.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!data || typeof data !== 'object' || !('kind' in data)) {
        finish(new Error('The Word document reader returned an invalid result.'));
      } else if (
        data.kind === 'result' &&
        'xml' in data &&
        data.xml instanceof Uint8Array &&
        data.xml.length > 0 &&
        data.xml.length <= maxDocxXmlBytes
      ) {
        finish(undefined, data.xml);
      } else if (data.kind === 'error') {
        finish(
          new Error(
            'Could not open this Word document. Use a valid, unencrypted .docx with text under 4 MB.',
          ),
        );
      } else {
        finish(new Error('The Word document reader returned an invalid result.'));
      }
    };
    try {
      if (signal.aborted) abort();
      else worker.postMessage({ file });
    } catch {
      finish(new Error('Could not send this Word document to the reader. Try again.'));
    }
  });
}
