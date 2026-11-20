import type { OcrJob, OcrLanguage, OcrMessage } from './ocr-worker';

export function recognizeOcrImage(
  image: Blob,
  language: OcrLanguage,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
) {
  return new Promise<{ text: string; confidence: number }>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    let worker: Worker;
    try {
      worker = new Worker(new URL('./ocr-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      reject(new Error('The OCR worker could not start. Try again.'));
      return;
    }
    const timeout = setTimeout(() => finish(new Error('OCR took too long. Try a smaller crop.')), 60_000);
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const finish = (error?: Error, result?: { text: string; confidence: number }) => {
      worker.terminate();
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result!);
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('The OCR worker could not read this image. Try again.'));
    worker.onmessage = ({ data }: MessageEvent<OcrMessage>) => {
      if (data.kind === 'progress') onProgress(data.percent);
      else if (data.kind === 'error') finish(new Error('Could not load OCR or read this image. Try again.'));
      else finish(undefined, { text: data.text, confidence: data.confidence });
    };
    try {
      worker.postMessage({ image, language } satisfies OcrJob);
    } catch {
      finish(new Error('Could not send the image crop to OCR. Try again.'));
    }
  });
}

export function ocrCanvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the image crop.'))),
      'image/png',
    ),
  );
}
