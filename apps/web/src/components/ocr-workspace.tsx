'use client';

import { useEffect, useRef, useState } from 'react';
import type { GetToken } from '@/lib/ai-client';
import { drawOcrImage, fullImage, type Crop, validateImage } from '@/lib/ocr-image';
import { openOcrPdf, readDocxText, type OcrPdf, type OcrSourceFormat } from '@/lib/ocr-documents';
import { ocrCanvasBlob, recognizeOcrImage } from '@/lib/ocr-recognize';
import type { OcrLanguage } from '@/lib/ocr-worker';
import { CourseNoteHandoff } from './course-note-handoff';

export function OcrWorkspace(props: { ownerId: string; getToken: GetToken }) {
  return <OwnedOcrWorkspace key={props.ownerId} {...props} />;
}

function OwnedOcrWorkspace({ ownerId, getToken }: { ownerId: string; getToken: GetToken }) {
  const preview = useRef<HTMLCanvasElement>(null);
  const pdf = useRef<OcrPdf | null>(null);
  const fileController = useRef<AbortController | null>(null);
  const operation = useRef<AbortController | null>(null);
  const loadId = useRef(0);
  const pageLoadId = useRef(0);
  const mounted = useRef(true);
  const [format, setFormat] = useState<OcrSourceFormat>('image');
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
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
  const [scope, setScope] = useState<'file' | 'preview' | 'document'>('preview');
  const imageSettings = JSON.stringify([filename, pageNumber, crop, turns, language]);
  const settings =
    scope === 'preview' ? imageSettings : `${loadId.current}:${scope === 'document' ? language : 'text'}`;
  const currentResult = !!recognizedFrom && recognizedFrom === settings;

  function releaseFile() {
    fileController.current?.abort();
    fileController.current = null;
    void pdf.current?.destroy().catch(() => {});
    pdf.current = null;
  }

  function reset() {
    operation.current?.abort();
    operation.current = null;
    releaseFile();
    loadId.current += 1;
    pageLoadId.current += 1;
    setBitmap(null);
    setCrop(fullImage);
    setTurns(0);
    setPageNumber(1);
    setPageCount(0);
    setError('');
    setStatus('');
    setFilename('');
    setText('');
    setConfidence(null);
    setRecognizedFrom('');
    setBusy(false);
    setLoading(false);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadId.current += 1;
      pageLoadId.current += 1;
      operation.current?.abort();
      releaseFile();
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

  function complete(
    value: string,
    estimate: number | null,
    nextScope: typeof scope,
    origin: string,
    message: string,
  ) {
    setText(value);
    setConfidence(estimate);
    setScope(nextScope);
    setRecognizedFrom(origin);
    setResult((current) => current + 1);
    setStatus(message);
  }

  async function load(file: File) {
    reset();
    const id = loadId.current;
    const controller = new AbortController();
    fileController.current = controller;
    const current = () => id === loadId.current && mounted.current && !controller.signal.aborted;
    setLoading(true);
    setFilename(file.name);
    const timeout = setTimeout(() => {
      if (!current()) return;
      controller.abort();
      setLoading(false);
      setError('Opening this file took too long. Try a smaller file.');
    }, 45_000);
    try {
      if (format === 'docx') {
        const value = await readDocxText(file, controller.signal);
        if (current())
          complete(
            value,
            null,
            'file',
            `${id}:text`,
            'Word text extracted. Review and correct the text before saving. Embedded images are not OCRed.',
          );
      } else if (format === 'pdf') {
        const document = await openOcrPdf(file, controller.signal);
        if (!current()) {
          await document.destroy();
          return;
        }
        pdf.current = document;
        setPageCount(document.pageCount);
        const next = await document.renderPage(1);
        if (!current()) {
          next.close();
          return;
        }
        setBitmap(next);
        setError(document.pageWarning(1) ?? '');
        setStatus('PDF ready. Extract selectable text, or use OCR for scanned pages.');
      } else {
        validateImage(file, 1, 1);
        const next = await createImageBitmap(file);
        if (!current()) {
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
      }
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : 'Could not open this file.');
    } finally {
      clearTimeout(timeout);
      if (current()) setLoading(false);
    }
  }

  async function changePage(number: number) {
    const document = pdf.current;
    if (!document) return;
    const fileId = loadId.current;
    const id = ++pageLoadId.current;
    setPageNumber(number);
    setLoading(true);
    setError('');
    try {
      const next = await document.renderPage(number);
      if (!mounted.current || fileId !== loadId.current || id !== pageLoadId.current) {
        next.close();
        return;
      }
      setBitmap(next);
      setError(document.pageWarning(number) ?? '');
      setCrop(fullImage);
      setTurns(0);
    } catch {
      if (mounted.current && fileId === loadId.current && id === pageLoadId.current)
        setError('Could not preview this PDF page. Try opening the PDF again.');
    } finally {
      if (mounted.current && fileId === loadId.current && id === pageLoadId.current) setLoading(false);
    }
  }

  async function start(kind: 'preview' | 'extract' | 'all' = 'preview') {
    if (operation.current || loading || !bitmap || !preview.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const current = () => operation.current === controller && mounted.current && !controller.signal.aborted;
    const fileId = loadId.current;
    const document = pdf.current;
    setBusy(true);
    setProgress(0);
    setError('');
    setStatus(kind === 'extract' ? 'Extracting PDF text.' : 'Reading image.');
    const timeout = setTimeout(
      () => {
        if (!current()) return;
        controller.abort();
        operation.current = null;
        setBusy(false);
        setError('This operation took too long. Read a smaller crop or one PDF page at a time.');
      },
      kind === 'all' ? 5 * 60_000 : 60_000,
    );
    try {
      if (kind === 'extract' && document) {
        const extracted = await document.extractText((page) => {
          if (current()) setProgress(Math.round((page / document.pageCount) * 100));
        }, controller.signal);
        if (!current()) return;
        if (!extracted.text)
          throw new Error(
            'No selectable text was found in this PDF. Use Read PDF page or Read all PDF pages for scanned pages.',
          );
        const skipped = extracted.emptyPages.length
          ? ` Pages ${extracted.emptyPages.join(', ')} have no selectable text; use OCR for those pages.`
          : '';
        complete(
          extracted.text,
          null,
          'file',
          `${fileId}:text`,
          `PDF text extracted. Review and correct the text before saving.${skipped}`,
        );
      } else if (kind === 'all' && document) {
        const pages: string[] = [];
        const empty: number[] = [];
        let estimate = 0;
        for (let page = 1; page <= document.pageCount; page += 1) {
          if (!current()) return;
          setStatus(`Reading PDF page ${page} of ${document.pageCount}.`);
          const rendered = await document.renderPage(page, controller.signal);
          let image: Blob;
          try {
            const canvas = window.document.createElement('canvas');
            drawOcrImage(canvas, rendered, fullImage, 0);
            image = await ocrCanvasBlob(canvas);
            canvas.width = canvas.height = 0;
          } finally {
            rendered.close();
          }
          const read = await recognizeOcrImage(image, language, controller.signal, (percent) => {
            if (current()) setProgress(Math.round(((page - 1 + percent / 100) / document.pageCount) * 100));
          });
          if (read.text.trim()) {
            pages.push(`Page ${page}\n${read.text.trim()}`);
            estimate += read.confidence;
          } else empty.push(page);
          if (pages.join('\n\n').length > 500_000)
            throw new Error('This PDF has too much text. Split it into smaller PDFs and retry.');
        }
        if (!current()) return;
        if (!pages.length)
          throw new Error('No text was found. Check the selected language or read a cropped PDF page.');
        complete(
          pages.join('\n\n'),
          estimate / pages.length,
          'document',
          `${fileId}:${language}`,
          `OCR complete for ${document.pageCount} PDF pages. Review and correct the text before saving.${empty.length ? ` No text was detected on pages ${empty.join(', ')}.` : ''}`,
        );
      } else {
        const image = await ocrCanvasBlob(preview.current);
        const read = await recognizeOcrImage(image, language, controller.signal, (percent) => {
          if (current()) setProgress(percent);
        });
        if (!current()) return;
        if (!read.text.trim()) throw new Error('No text was found. Check the crop and selected language.');
        complete(
          read.text,
          read.confidence,
          'preview',
          imageSettings,
          format === 'pdf'
            ? `OCR complete for PDF page ${pageNumber} only. Review and correct the text before saving.`
            : 'OCR complete. Review and correct the text before saving.',
        );
      }
    } catch (cause) {
      if (current())
        setError(cause instanceof Error ? cause.message : 'Could not read this file. Try again.');
    } finally {
      clearTimeout(timeout);
      if (operation.current === controller) {
        operation.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }

  const button =
    'rounded border border-blue-700 px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50';
  return (
    <section id="ocr" className="min-w-0 space-y-3 rounded border p-4" aria-label="Image to notes">
      <h2 className="text-sm font-semibold">English and Bangla OCR</h2>
      <p className="text-sm">Import images, PDF, or Word documents. Files are processed in this browser.</p>
      <label className="block text-sm">
        Source format
        <select
          className="mt-1 block w-full rounded border p-2"
          value={format}
          disabled={busy || loading}
          onChange={(event) => {
            reset();
            setFormat(event.target.value as OcrSourceFormat);
          }}
        >
          <option value="image">Image (PNG, JPG, WebP)</option>
          <option value="pdf">PDF (text or scanned pages)</option>
          <option value="docx">Word document (.docx)</option>
        </select>
      </label>
      <label className="block text-sm">
        {format === 'image'
          ? 'Choose an image'
          : format === 'pdf'
            ? 'Choose a PDF'
            : 'Choose a Word document'}
        <input
          key={format}
          type="file"
          accept={
            format === 'image'
              ? 'image/png,image/jpeg,image/webp'
              : format === 'pdf'
                ? '.pdf,application/pdf'
                : '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          }
          className="mt-1 block w-full min-w-0"
          disabled={busy || loading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void load(file);
          }}
        />
      </label>
      <p className="text-xs text-slate-600">
        Up to 15 MB per file. PDFs: up to 30 pages, with images up to 16 million pixels. For Google Docs or
        older .doc files, download or save as .docx or PDF first. Word imports text; export scanned Word pages
        as PDF for OCR.
      </p>
      {format !== 'docx' ? (
        <label className="block text-sm">
          Text language
          <select
            className="ml-2 max-w-full rounded border p-1"
            value={language}
            disabled={busy || loading}
            onChange={(event) => setLanguage(event.target.value as OcrLanguage)}
          >
            <option value="eng">English</option>
            <option value="ben">Bangla</option>
            <option value="both">English and Bangla</option>
          </select>
        </label>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm">
          Opening {format === 'image' ? 'image' : 'document'}.
        </p>
      ) : null}
      {loading ? (
        <button
          type="button"
          className={button}
          onClick={() => {
            reset();
            setStatus('Import cancelled.');
          }}
        >
          Cancel import
        </button>
      ) : null}
      {pageCount ? (
        <label className="block text-sm">
          PDF page
          <select
            aria-label="PDF page"
            className="ml-2 rounded border p-1"
            value={pageNumber}
            disabled={busy || loading}
            onChange={(event) => void changePage(Number(event.target.value))}
          >
            {Array.from({ length: pageCount }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {index + 1} of {pageCount}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {bitmap ? (
        <>
          <canvas
            ref={preview}
            role="img"
            aria-label="Cropped and rotated image preview"
            className="max-h-60 w-auto max-w-full rounded border object-contain"
          />
          <fieldset className="grid grid-cols-2 gap-2" disabled={busy || loading}>
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
              disabled={busy || loading}
              onClick={() => setTurns((current) => (current + 1) % 4)}
            >
              Rotate right
            </button>
            <button
              type="button"
              className={button}
              disabled={busy || loading}
              onClick={() => {
                setTurns(0);
                setCrop(fullImage);
              }}
            >
              Reset image
            </button>
            <button type="button" className={button} disabled={busy || loading} onClick={() => void start()}>
              {format === 'pdf' ? 'Read PDF page' : 'Read image'}
            </button>
          </div>
          {format === 'pdf' ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={busy || loading}
                  onClick={() => void start('extract')}
                >
                  Extract PDF text
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy || loading}
                  onClick={() => void start('all')}
                >
                  Read all PDF pages
                </button>
              </div>
              <p className="text-xs text-slate-600">
                Extract PDF text reads selectable text on all pages. Read PDF page replaces the result with
                OCR of this preview. Read all PDF pages uses full pages, without the preview crop or rotation,
                and replaces the result when complete.
              </p>
            </>
          ) : null}
        </>
      ) : null}
      {busy ? (
        <>
          <p role="status" className="text-sm">
            {progress}% complete
          </p>
          <button
            type="button"
            className={button}
            onClick={() => {
              operation.current?.abort();
              operation.current = null;
              setBusy(false);
              setStatus('OCR cancelled.');
            }}
          >
            Cancel OCR
          </button>
        </>
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
      {recognizedFrom ? (
        <>
          {confidence !== null ? (
            <p className="text-sm">
              OCR confidence estimate {Math.round(confidence)}%. Review names, numbers, and uncertain
              characters against the {format === 'pdf' ? 'PDF' : 'image'}.
            </p>
          ) : null}
          {!currentResult ? (
            <p role="status" className="text-sm">
              {format === 'image'
                ? 'The image settings changed. Read the image again before saving its text.'
                : 'The PDF page or OCR settings changed. Read it again before saving its text.'}
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
          {text.trim() && currentResult && !busy && !loading ? (
            <CourseNoteHandoff key={result} ownerId={ownerId} getToken={getToken} text={text} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
