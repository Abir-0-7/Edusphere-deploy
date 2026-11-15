'use client';

import { useAuth } from '@clerk/nextjs';
import { useState } from 'react';
import { Tldraw, getSnapshot, loadSnapshot, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';

/**
 * Rich study tools (tasks 4.6-4.10): whiteboard, cover-page PDF, OCR,
 * citations and the Big-O code reviewer. The heavyweight ones (whiteboard,
 * OCR, cover PDF, client OCR) run entirely client-side so no paid service is
 * touched.
 */
const baseUrl = () => process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';

// --- Whiteboard (4.6) ------------------------------------------------------
function Whiteboard() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [error, setError] = useState('');

  const save = () => {
    if (!editor) return;
    try {
      const json = JSON.stringify(getSnapshot(editor.store));
      localStorage.setItem('studyvault_whiteboard', json);
      setSavedJson(json);
      setError('');
    } catch {
      setError('Could not save this board.');
    }
  };
  const load = () => {
    if (!editor) return;
    const raw = localStorage.getItem('studyvault_whiteboard');
    if (!raw) return;
    try {
      const snapshot: unknown = JSON.parse(raw);
      loadSnapshot(editor.store, snapshot as Parameters<typeof loadSnapshot>[1]);
      setSavedJson(raw);
      setError('');
    } catch {
      setError('Saved board data is invalid.');
    }
  };
  const clear = () => {
    editor?.selectAll();
    editor?.deleteShapes(editor.getSelectedShapeIds());
    setError('');
  };

  return (
    <section className="rounded border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Whiteboard</h2>
        <div className="flex gap-2 text-xs">
          <button onClick={save} className="rounded border px-2 py-1">
            Save
          </button>
          <button onClick={load} className="rounded border px-2 py-1">
            Load
          </button>
          <button onClick={clear} className="rounded border px-2 py-1">
            Clear
          </button>
        </div>
      </div>
      <div className="mt-2 h-[min(65vh,560px)] min-h-[360px] overflow-hidden rounded border" aria-label="Whiteboard canvas">
        <Tldraw onMount={setEditor} persistenceKey="studyvault-whiteboard" />
      </div>
      {savedJson && <p className="mt-1 text-xs text-neutral-500">Saved locally.</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </section>
  );
}

// --- Cover page PDF (4.8) --------------------------------------------------
function CoverPdf() {
  const [title, setTitle] = useState('Study Notes');
  const [meta, setMeta] = useState('Abir · 2026');

  const build = async () => {
    // pdf-lib, lazily imported so the bundle stays small and the page works
    // even before the library is added.
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText(title, { x: 70, y: 650, size: 42, font, color: rgb(0.05, 0.15, 0.4) });
    const small = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(meta, { x: 70, y: 610, size: 18, font: small, color: rgb(0.3, 0.3, 0.35) });
    const bytes = await doc.save();
    // pdf-lib returns Uint8Array<ArrayBufferLike>; copy into a plain ArrayBuffer
    // so it satisfies BlobPart on strict TS.
    const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cover.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded border p-4">
      <h2 className="text-sm font-semibold">Cover page PDF</h2>
      <div className="mt-2 space-y-2">
        <label htmlFor="cover-title" className="block text-sm font-medium">Title</label>
        <input
          id="cover-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded border px-3 py-1.5 text-sm"
        />
        <label htmlFor="cover-byline" className="block text-sm font-medium">Name or year</label>
        <input
          id="cover-byline"
          value={meta}
          onChange={(e) => setMeta(e.target.value)}
          placeholder="Name / year"
          className="w-full rounded border px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => void build()}
          className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-white"
        >
          Download cover.pdf
        </button>
      </div>
    </section>
  );
}

// --- Client-side OCR (4.7) -------------------------------------------------
function ClientOcr() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const run = async (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    if (file.size > 15 * 1024 * 1024) { setError('Image must be 15 MB or smaller.'); return; }
    setBusy(true);
    setText('');
    setError('');
    setProgress(0);
    let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | undefined;
    try {
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker('eng', undefined, { logger: (message) => setProgress(Math.round(message.progress * 100)) });
      const { data } = await worker.recognize(file);
      setText(data.text);
    } catch {
      setError('OCR could not read this image.');
    } finally {
      await worker?.terminate();
      setBusy(false);
    }
  };

  return (
    <section className="rounded border p-4">
      <h2 className="text-sm font-semibold">Client OCR</h2>
      <label htmlFor="ocr-image" className="mt-2 block text-sm font-medium">Choose an image</label>
      <input
        id="ocr-image"
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => e.target.files?.[0] && void run(e.target.files[0])}
        className="mt-2 text-sm"
      />
      {busy && <p className="mt-1 text-xs text-neutral-500" role="status">Reading image: {progress}%</p>}
      {error && <p className="mt-1 text-xs text-red-700" role="alert">{error}</p>}
      {text && (
        <pre className="mt-2 max-h-40 whitespace-pre-wrap overflow-auto rounded bg-neutral-50 p-2 text-xs">
          {text}
        </pre>
      )}
    </section>
  );
}

// --- Citation formatter (4.9) ----------------------------------------------
function CitationForm() {
  const { getToken } = useAuth();
  const [style, setStyle] = useState('apa');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);

  const cite = async () => {
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl()}/api/citations`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          style,
          authors: ['Ada Lovelace', 'Charles Babbage'],
          title: 'Analytical Engine Notes',
          year: '1843',
          container: 'Memoirs of the Academy',
          url: 'https://example.org/notes',
        }),
      });
      const data = (await res.json()) as { citation: string };
      setOut(data.citation);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded border p-4">
      <h2 className="text-sm font-semibold">Citation</h2>
      <div className="mt-2 flex gap-2 text-sm">
        {['apa', 'mla', 'ieee'].map((s) => (
          <button
            key={s}
            onClick={() => setStyle(s)}
          aria-pressed={style === s}
            className={`rounded border px-3 py-1 uppercase ${style === s ? 'bg-blue-600 text-white' : ''}`}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => void cite()}
          disabled={busy}
          className="ml-auto rounded bg-neutral-800 px-3 py-1 text-white disabled:opacity-50"
        >
          {busy ? '…' : 'Format'}
        </button>
      </div>
      {out && <p className="mt-2 rounded bg-neutral-50 p-2 text-sm">{out}</p>}
    </section>
  );
}

// --- Big-O code reviewer (4.10) ---------------------------------------------
function CodeReview() {
  const { getToken } = useAuth();
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('python');
  const [review, setReview] = useState<{
    time_complexity: string;
    space_complexity: string;
    explanation: string;
    improvements: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const analyze = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl()}/api/code-review`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ code, language }),
      });
      setReview((await res.json()) as typeof review);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded border p-4">
      <h2 className="text-sm font-semibold">Big-O reviewer</h2>
      <div className="mt-2 flex gap-2">
        <label htmlFor="code-language" className="sr-only">Code language</label>
        <select
          id="code-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="rounded border px-2 py-1.5 text-sm"
        >
          <option>python</option>
          <option>javascript</option>
          <option>typescript</option>
          <option>other</option>
        </select>
        <button
          onClick={() => void analyze()}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? 'Analysing…' : 'Analyse'}
        </button>
      </div>
      <label htmlFor="code-input" className="sr-only">Code to review</label>
      <textarea
        id="code-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Paste code…"
        className="mt-2 h-36 w-full rounded border px-3 py-2 font-mono text-xs"
      />
      {review && (
        <div className="mt-3 rounded bg-neutral-50 p-3 text-sm">
          <p>
            <strong>Time:</strong> {review.time_complexity} · <strong>Space:</strong>{' '}
            {review.space_complexity}
          </p>
          <p className="mt-1 text-neutral-700">{review.explanation}</p>
          {review.improvements.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-neutral-600">
              {review.improvements.map((imp, i) => (
                <li key={i}>{imp}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default function ToolsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Tools</h1>
      <Whiteboard />
      <div className="grid gap-6 sm:grid-cols-2">
        <CoverPdf />
        <ClientOcr />
      </div>
      <CitationForm />
      <CodeReview />
    </main>
  );
}
