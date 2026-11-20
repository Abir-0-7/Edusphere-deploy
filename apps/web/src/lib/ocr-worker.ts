import { createWorker } from 'tesseract.js';

export type OcrLanguage = 'eng' | 'ben' | 'both';
export type OcrJob = { image: Blob; language: OcrLanguage };
export type OcrMessage =
  | { kind: 'progress'; percent: number }
  | { kind: 'result'; text: string; confidence: number }
  | { kind: 'error' };

const scope = self;
const send = (data: OcrMessage) => scope.postMessage(data);

scope.addEventListener(
  'message',
  (event: MessageEvent<OcrJob>) => {
    void recognize(event.data);
  },
  { once: true },
);

async function recognize({ image, language }: OcrJob) {
  const origin = scope.location.origin;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    worker = await createWorker(language === 'both' ? ['eng', 'ben'] : language, undefined, {
      workerPath: `${origin}/ocr/worker.min.js`,
      corePath: `${origin}/ocr/core`,
      langPath: `${origin}/ocr/lang`,
      workerBlobURL: false,
      logger: (message) => {
        if (message.status === 'recognizing text') {
          send({ kind: 'progress', percent: Math.round(message.progress * 100) });
        }
      },
      errorHandler: () => send({ kind: 'error' }),
    });
    const { data } = await worker.recognize(image);
    await worker.terminate();
    worker = undefined;
    send({ kind: 'result', text: data.text, confidence: data.confidence });
  } catch {
    send({ kind: 'error' });
  } finally {
    await worker?.terminate();
  }
}
