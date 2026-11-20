'use client';

import { useEffect, useRef, useState } from 'react';
import type { GetToken } from '@/lib/ai-client';
import { drawOcrImage, fullImage, validateImage, type Crop } from '@/lib/ocr-image';
import type { OcrJob, OcrLanguage, OcrMessage } from '@/lib/ocr-worker';
import { CourseNoteHandoff } from './course-note-handoff';

export function OcrWorkspace(props: { ownerId: string; getToken: GetToken }) {
  return <OwnedOcrWorkspace key={props.ownerId} {...props} />;
}

function OwnedOcrWorkspace({ ownerId, getToken }: { ownerId: string; getToken: GetToken }) {
  const preview = useRef<HTMLCanvasElement>(null);
  const run = useRef<{ worker: Worker; timeout: ReturnType<typeof setTimeout> } | null>(null);
  const loadId = useRef(0);
  const mounted = useRef(true);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<Crop>(fullImage);
  const [turns, setTurns] = useState(0);
  const [language, setLanguage] = useState<OcrLanguage>('eng');
  const [text, setText] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(0);
  const [filename, setFilename] = useState('');
  const [recognizedFrom, setRecognizedFrom] = useState('');
  const imageSettings = JSON.stringify([filename, crop, turns, language]);

  function releaseWorker() {
    if (!run.current) return;
    run.current.worker.terminate();
    clearTimeout(run.current.timeout);
    run.current = null;
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadId.current += 1;
      releaseWorker();
    };
  }, []);
  useEffect(() => () => bitmap?.close(), [bitmap]);
  useEffect(() => {
    if (preview.current && bitmap) {
      try {
        drawOcrImage(preview.current, bitmap, crop, turns);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not prepare this image.');
      }
    }
  }, [bitmap, crop, turns]);

  async function load(file: File) {
    const id = ++loadId.current;
    setLoading(true);
    setBitmap(null);
    setCrop(fullImage);
    setTurns(0);
    setError('');
    setStatus('');
    setFilename(file.name);
    setText('');
    setConfidence(null);
    setRecognizedFrom('');
    try {
      validateImage(file, 1, 1);
      const next = await createImageBitmap(file);
      if (loadId.current !== id || !mounted.current) {
        next.close();
        return;
      }
      try {
        validateImage(file, next.width, next.height);
        setBitmap(next);
      } catch (cause) {
        next.close();
        throw cause;
      }
    } catch (cause) {
      if (loadId.current === id && mounted.current)
        setError(cause instanceof Error ? cause.message : 'Could not open this image.');
    } finally {
      if (loadId.current === id && mounted.current) setLoading(false);
    }
  }

  function start() {
    if (!bitmap || run.current || !preview.current || !mounted.current) return;
    setBusy(true);
    setProgress(0);
    setError('');
    setStatus('');
    let worker: Worker;
    try {
      worker = new Worker(new URL('../lib/ocr-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setBusy(false);
      setError('The OCR worker could not start. Try again.');
      return;
    }

    function fail(message: string) {
      if (run.current?.worker !== worker || !mounted.current) return;
      releaseWorker();
      setBusy(false);
      setError(message);
    }

    run.current = {
      worker,
      timeout: setTimeout(() => fail('OCR took too long. Try a smaller crop.'), 60_000),
    };
    worker.onerror = () => fail('The OCR worker could not read this image. Try again.');
    worker.onmessage = ({ data }: MessageEvent<OcrMessage>) => {
      if (run.current?.worker !== worker || !mounted.current) return;
      if (data.kind === 'progress') {
        setProgress(data.percent);
        return;
      }
      if (data.kind === 'error') {
        fail('Could not load OCR or read this image. Try again.');
        return;
      }
      if (!data.text.trim()) {
        fail('No text was found. Check the crop and selected language.');
        return;
      }
      releaseWorker();
      setBusy(false);
      setText(data.text);
      setConfidence(data.confidence);
      setRecognizedFrom(imageSettings);
      setResult((current) => current + 1);
      setStatus('OCR complete. Review and correct the text before saving.');
    };
    preview.current.toBlob((image) => {
      if (run.current?.worker !== worker) return;
      if (!image) {
        fail('Could not prepare the image crop.');
        return;
      }
      try {
        worker.postMessage({ image, language } satisfies OcrJob);
      } catch {
        fail('Could not send the image crop to OCR. Try again.');
      }
    }, 'image/png');
  }

  const button =
    'rounded border border-blue-700 px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50';
  return (
    <section id="ocr" className="min-w-0 space-y-3 rounded border p-4" aria-label="Image to notes">
      <h2 className="text-sm font-semibold">English and Bangla OCR</h2>
      <p className="text-sm">Your image is processed in this browser.</p>
      <label className="block text-sm">
        Choose an image
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="mt-1 block w-full"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void load(file);
          }}
        />
      </label>
      <label className="block text-sm">
        Text language
        <select
          className="ml-2 rounded border p-1"
          value={language}
          disabled={busy}
          onChange={(event) => setLanguage(event.target.value as OcrLanguage)}
        >
          <option value="eng">English</option>
          <option value="ben">Bangla</option>
          <option value="both">English and Bangla</option>
        </select>
      </label>
      {loading ? (
        <p role="status" className="text-sm">
          Opening image.
        </p>
      ) : null}
      {bitmap ? (
        <>
          <canvas
            ref={preview}
            role="img"
            aria-label="Cropped and rotated image preview"
            className="max-h-60 w-auto max-w-full rounded border object-contain"
          />
          <fieldset className="grid grid-cols-2 gap-2" disabled={busy}>
            <legend className="text-sm">Crop from the original edges</legend>
            {(['left', 'top', 'right', 'bottom'] as const).map((edge) => {
              const reverse = { left: 'right', top: 'bottom', right: 'left', bottom: 'top' } as const;
              return (
                <label key={edge} className="min-w-0 text-sm">
                  {`Crop ${edge} (%)`}
                  <input
                    aria-label={`Crop ${edge} (%)`}
                    type="range"
                    className="block w-full"
                    min={0}
                    max={95 - crop[reverse[edge]]}
                    value={crop[edge]}
                    onChange={(event) =>
                      setCrop((current) => ({ ...current, [edge]: Number(event.target.value) }))
                    }
                  />
                </label>
              );
            })}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => setTurns((current) => (current + 1) % 4)}
            >
              Rotate right
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => {
                setTurns(0);
                setCrop(fullImage);
              }}
            >
              Reset image
            </button>
            <button type="button" className={button} disabled={busy} onClick={start}>
              Read image
            </button>
            {busy ? (
              <button
                type="button"
                className={button}
                onClick={() => {
                  releaseWorker();
                  setBusy(false);
                  setStatus('OCR cancelled.');
                }}
              >
                Cancel OCR
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm">
          Reading image. {progress}%
        </p>
      ) : null}
      {status ? (
        <p role="status" className="text-sm">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {confidence !== null ? (
        <>
          <p className="text-sm">
            OCR confidence estimate {Math.round(confidence)}%. Review names, numbers, and uncertain characters
            against the image.
          </p>
          {recognizedFrom !== imageSettings ? (
            <p role="status" className="text-sm">
              The image settings changed. Read the image again before saving its text.
            </p>
          ) : null}
          <label className="block text-sm">
            Recognized text
            <textarea
              className="mt-1 min-h-32 w-full rounded border border-slate-500 p-2"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {text.trim() && recognizedFrom === imageSettings ? (
            <CourseNoteHandoff key={result} ownerId={ownerId} getToken={getToken} text={text} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
