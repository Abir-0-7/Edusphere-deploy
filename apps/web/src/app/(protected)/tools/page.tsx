'use client';

import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Tldraw, getSnapshot, loadSnapshot, type Editor } from 'tldraw';
import { z } from 'zod';
import 'tldraw/tldraw.css';

const baseUrl = () => process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';
const inputClass = 'w-full rounded border border-[var(--line)] bg-white px-3 py-2 text-sm';
const labelClass = 'mb-1.5 block text-xs font-semibold text-[var(--ink)]';
const citationSchema = z.object({ citation: z.string(), style: z.string() });
const reviewSchema = z.object({
  time_complexity: z.string(),
  space_complexity: z.string(),
  explanation: z.string(),
  improvements: z.array(z.string()),
});

function serviceError(status: number, tool: string) {
  if (status === 401 || status === 403) return 'Your session could not be verified. Sign in again, then retry.';
  if (status === 429) return 'You have reached the current request limit. Please try again later.';
  return `${tool} is unavailable right now (HTTP ${status}). Please retry in a moment.`;
}

function failureMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError) return `${fallback} Check your connection, then retry.`;
  return error instanceof Error ? error.message : fallback;
}

function Whiteboard() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = () => {
    if (!editor) return;
    try {
      localStorage.setItem('studyvault_whiteboard', JSON.stringify(getSnapshot(editor.store)));
      setSaved(true);
      setError('');
    } catch {
      setError('Could not save this board. Your browser may have disabled local storage or run out of space.');
    }
  };
  const load = () => {
    if (!editor) return;
    try {
      const raw = localStorage.getItem('studyvault_whiteboard');
      if (!raw) {
        setError('There is no manually saved board in this browser yet.');
        return;
      }
      const snapshot: unknown = JSON.parse(raw);
      loadSnapshot(editor.store, snapshot as Parameters<typeof loadSnapshot>[1]);
      setSaved(true);
      setError('');
    } catch {
      setError('Could not restore the saved board. Keep the current board and try saving it again.');
    }
  };
  const clear = () => {
    editor?.selectAll();
    editor?.deleteShapes(editor.getSelectedShapeIds());
    setSaved(false);
    setError('');
  };

  return (
    <section id="whiteboard" className="surface surface-padded scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-heading">Think on a whiteboard</h2>
          <p className="section-caption">Sketch a diagram or work through a problem. Boards stay in this browser.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={!editor} className="action-secondary disabled:opacity-50">Save</button>
          <button onClick={load} disabled={!editor} className="action-secondary disabled:opacity-50">Load</button>
          <button onClick={clear} disabled={!editor} className="action-secondary disabled:opacity-50">Clear</button>
        </div>
      </div>
      <div className="relative mt-4 h-[min(65vh,560px)] min-h-[360px] overflow-hidden rounded border border-[var(--line)]" aria-label="Whiteboard canvas">
        <Tldraw onMount={setEditor} persistenceKey="studyvault-whiteboard" />
      </div>
      {saved && <p role="status" className="mt-3 text-xs text-[var(--forest)]">Saved in this browser.</p>}
      {error && <p role="alert" className="status-error mt-3">{error}</p>}
    </section>
  );
}

function CoverPdf() {
  const [title, setTitle] = useState('Study Notes');
  const [meta, setMeta] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const build = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const doc = await PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      page.drawText(title.trim(), { x: 70, y: 650, size: 32, font, maxWidth: 472, lineHeight: 38, color: rgb(0.06, 0.3, 0.23) });
      const small = await doc.embedFont(StandardFonts.Helvetica);
      page.drawText(meta.trim(), { x: 70, y: 495, size: 16, font: small, maxWidth: 472, lineHeight: 23, color: rgb(0.35, 0.4, 0.37) });
      const bytes = await doc.save();
      const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'cover.pdf';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not create this cover. Use Latin characters in the title and byline, then try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="cover" className="surface surface-padded scroll-mt-20">
      <p className="page-kicker">PRESENT YOUR WORK</p>
      <h2 className="section-heading">Assignment cover page</h2>
      <p className="section-caption">Create a simple PDF cover with your own title and details.</p>
      <form onSubmit={(event) => void build(event)} className="mt-5 space-y-4">
        <div>
          <label htmlFor="cover-title" className={labelClass}>Assignment title</label>
          <input id="cover-title" required maxLength={90} value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="cover-byline" className={labelClass}>Your name, course, or year</label>
          <input id="cover-byline" maxLength={150} value={meta} onChange={(event) => setMeta(event.target.value)} placeholder="e.g. Your name / CSE 101 / 2026" className={inputClass} />
        </div>
        <p className="text-xs text-[var(--muted)]">The cover font supports Latin characters.</p>
        {error && <p role="alert" className="status-error">{error}</p>}
        <button type="submit" disabled={busy || !title.trim()} className="action-primary disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Creating PDF...' : 'Download cover.pdf'}</button>
      </form>
    </section>
  );
}

function ClientOcr() {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('eng');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const run = async (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Choose an image file. For a PDF, upload it to your Library instead.'); return; }
    if (file.size > 15 * 1024 * 1024) { setError('Choose an image that is 15 MB or smaller.'); return; }
    setBusy(true);
    setText('');
    setError('');
    setProgress(0);
    let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | undefined;
    try {
      const { createWorker } = await import('tesseract.js');
      // Tesseract.js 7 accepts an array when a page contains multiple languages.
      const languages = language === 'both' ? ['eng', 'ben'] : language;
      worker = await createWorker(languages, undefined, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/core',
        langPath: '/ocr/lang',
        workerBlobURL: false,
        logger: (message) => {
          if (message.status === 'recognizing text') setProgress(Math.round(message.progress * 100));
        },
      });
      const { data } = await worker.recognize(file);
      if (!data.text.trim()) setError('No text was found. Try a sharper image and check the selected language.');
      setText(data.text);
    } catch {
      setError('Could not read this image. Check your connection so the OCR language files can load, then try a clear JPG or PNG.');
    } finally {
      try {
        await worker?.terminate();
      } catch {
        setError((current) => current || 'OCR finished, but could not release its browser resources. Refresh before trying another image.');
      }
      setBusy(false);
    }
  };

  return (
    <section id="ocr" className="surface surface-padded scroll-mt-20">
      <p className="page-kicker">FROM IMAGE TO NOTES</p>
      <h2 className="section-heading">English & Bangla OCR</h2>
      <p className="section-caption">Extract text from an image in your browser. Review the result before using it.</p>
      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="ocr-language" className={labelClass}>Text language</label>
          <select id="ocr-language" value={language} disabled={busy} onChange={(event) => setLanguage(event.target.value)} className={inputClass}>
            <option value="eng">English</option>
            <option value="ben">Bangla</option>
            <option value="both">English + Bangla</option>
          </select>
        </div>
        <div>
          <label htmlFor="ocr-image" className={labelClass}>Choose an image</label>
          <input id="ocr-image" type="file" accept="image/*" disabled={busy} onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void run(file);
            event.target.value = '';
          }} className="w-full text-xs file:mr-3 file:rounded file:border file:border-[var(--line)] file:bg-[var(--mint)] file:px-3 file:py-2 file:text-[var(--forest)]" />
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">Images up to 15 MB. Language files download on first use. For PDF chapters, use your <Link href="/library" className="font-semibold text-[var(--forest)] underline">Library</Link>.</p>
        </div>
        {busy && <div role="status" className="text-xs text-[var(--forest)]"><p>{progress === 0 ? 'Preparing OCR...' : `Reading image: ${progress}%`}</p><progress value={progress} max={100} aria-label="Image recognition progress" className="mt-2 h-2 w-full accent-[var(--forest)]" /></div>}
        {error && <p role="alert" className="status-error">{error}</p>}
        {text && <div><label htmlFor="ocr-result" className={labelClass}>Extracted text</label><textarea id="ocr-result" readOnly value={text} className={`${inputClass} min-h-44 resize-y leading-relaxed`} /></div>}
      </div>
    </section>
  );
}

function CitationForm() {
  const { getToken } = useAuth();
  const [style, setStyle] = useState('apa');
  const [authors, setAuthors] = useState('');
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [container, setContainer] = useState('');
  const [url, setUrl] = useState('');
  const [pages, setPages] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setOut('');
    setError('');
    try {
      const token = await getToken();
      const response = await fetch(`${baseUrl()}/api/citations`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          style,
          authors: authors.split(/\r?\n|;/).map((author) => author.trim()).filter(Boolean),
          title: title.trim(), year: year.trim(), container: container.trim(), url: url.trim(), pages: pages.trim(),
        }),
      });
      if (!response.ok) throw new Error(serviceError(response.status, 'Citation formatting'));
      const data = citationSchema.safeParse(await response.json());
      if (!data.success) throw new Error('The citation service returned an incomplete result. Please retry.');
      setOut(data.data.citation);
    } catch (cause) {
      setError(failureMessage(cause, 'Could not format this citation.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="citations" className="surface surface-padded scroll-mt-20">
      <p className="page-kicker">CREDIT YOUR SOURCES</p>
      <h2 className="section-heading">Citation formatter</h2>
      <p className="section-caption">Enter the details from your source, then format an APA, MLA, or IEEE reference.</p>
      <form onSubmit={(event) => void cite(event)} className="mt-5 space-y-4">
        <fieldset>
          <legend className={labelClass}>Citation style</legend>
          <div className="flex flex-wrap gap-2">
            {['apa', 'mla', 'ieee'].map((option) => <button type="button" key={option} onClick={() => { setStyle(option); setOut(''); }} aria-pressed={style === option} className={`${style === option ? 'action-primary' : 'action-secondary'} uppercase`}>{option}</button>)}
          </div>
        </fieldset>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="citation-title" className={labelClass}>Source title <span className="font-normal text-[var(--muted)]">(required)</span></label>
            <input id="citation-title" required maxLength={500} value={title} onChange={(event) => { setTitle(event.target.value); setOut(''); }} placeholder="Article, book, or webpage title" className={inputClass} />
          </div>
          <div>
            <label htmlFor="citation-authors" className={labelClass}>Authors</label>
            <textarea id="citation-authors" rows={2} maxLength={1000} value={authors} onChange={(event) => { setAuthors(event.target.value); setOut(''); }} placeholder="One full name per line" aria-describedby="citation-authors-help" className={`${inputClass} resize-y`} />
            <p id="citation-authors-help" className="mt-1.5 text-xs text-[var(--muted)]">Keep the author order shown in the source. Semicolons also separate names.</p>
          </div>
          <div className="space-y-4">
            <div><label htmlFor="citation-year" className={labelClass}>Publication year</label><input id="citation-year" maxLength={20} value={year} onChange={(event) => { setYear(event.target.value); setOut(''); }} placeholder="e.g. 2026" className={inputClass} /></div>
            <div><label htmlFor="citation-pages" className={labelClass}>Page range</label><input id="citation-pages" maxLength={50} value={pages} onChange={(event) => { setPages(event.target.value); setOut(''); }} placeholder="e.g. 12-18" className={inputClass} /></div>
          </div>
          <div><label htmlFor="citation-container" className={labelClass}>Journal, website, or publisher</label><input id="citation-container" maxLength={300} value={container} onChange={(event) => { setContainer(event.target.value); setOut(''); }} placeholder="Where the source was published" className={inputClass} /></div>
          <div><label htmlFor="citation-url" className={labelClass}>Source URL</label><input id="citation-url" type="url" maxLength={2000} value={url} onChange={(event) => { setUrl(event.target.value); setOut(''); }} placeholder="https://..." className={inputClass} /></div>
        </div>
        {error && <p role="alert" className="status-error">{error}</p>}
        <button type="submit" disabled={busy || !title.trim()} className="action-primary disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Formatting...' : `Format ${style.toUpperCase()} citation`}</button>
        {out && <div className="rounded border border-[var(--line)] bg-[var(--mint)] p-4" role="status"><p className="mb-2 text-xs font-semibold text-[var(--forest)]">Your formatted reference</p><p className="break-words text-sm leading-relaxed">{out}</p><p className="mt-3 text-xs text-[var(--muted)]">Check the details and your course requirements before submitting.</p></div>}
      </form>
    </section>
  );
}

function CodeReview() {
  const { getToken } = useAuth();
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('python');
  const [review, setReview] = useState<z.infer<typeof reviewSchema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const analyze = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setReview(null);
    setError('');
    try {
      const token = await getToken();
      const response = await fetch(`${baseUrl()}/api/code-review`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ code, language }),
      });
      if (!response.ok) throw new Error(serviceError(response.status, 'Code review'));
      const data = reviewSchema.safeParse(await response.json());
      if (!data.success) throw new Error('The reviewer returned an incomplete result. Please try again.');
      setReview(data.data);
    } catch (cause) {
      setError(failureMessage(cause, 'Could not review your code.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="complexity" className="surface surface-padded scroll-mt-20">
      <p className="page-kicker">UNDERSTAND YOUR ALGORITHM</p>
      <h2 className="section-heading">Big-O reviewer</h2>
      <p className="section-caption">Explore time and space complexity with an AI explanation. This tool reviews code without executing it.</p>
      <form onSubmit={(event) => void analyze(event)} className="mt-5 space-y-4">
        <div className="max-w-xs"><label htmlFor="code-language" className={labelClass}>Code language</label><select id="code-language" value={language} onChange={(event) => { setLanguage(event.target.value); setReview(null); }} className={inputClass}><option value="python">Python</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="other">Other</option></select></div>
        <div><label htmlFor="code-input" className={labelClass}>Code to review</label><textarea id="code-input" required maxLength={6000} value={code} onChange={(event) => { setCode(event.target.value); setReview(null); }} placeholder="Paste the algorithm you want to understand..." className={`${inputClass} min-h-52 resize-y font-mono text-xs leading-relaxed`} /><p className="mt-1.5 text-right text-xs text-[var(--muted)]">{code.length.toLocaleString()} / 6,000 characters</p></div>
        {error && <p role="alert" className="status-error">{error}</p>}
        <button type="submit" disabled={busy || !code.trim()} className="action-primary disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Reviewing complexity...' : 'Analyse complexity'}</button>
      </form>
      {review && <div className="mt-5 rounded border border-[var(--line)] bg-[var(--mint)] p-4" role="status"><div className="flex flex-wrap gap-x-8 gap-y-3"><div><p className="text-xs text-[var(--muted)]">Time complexity</p><p className="mt-1 font-mono text-lg font-semibold text-[var(--forest)]">{review.time_complexity}</p></div><div><p className="text-xs text-[var(--muted)]">Space complexity</p><p className="mt-1 font-mono text-lg font-semibold text-[var(--forest)]">{review.space_complexity}</p></div></div><p className="mt-4 text-sm leading-relaxed">{review.explanation}</p>{review.improvements.length > 0 && <div className="mt-4"><h3 className="text-xs font-semibold">Ways to improve</h3><ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">{review.improvements.map((improvement, index) => <li key={index}>{improvement}</li>)}</ul></div>}</div>}
    </section>
  );
}

export default function ToolsPage() {
  return (
    <main className="workspace-page space-y-6">
      <header className="page-heading-row flex-wrap">
        <div><p className="page-kicker">ACADEMIC TOOLKIT</p><h1 className="page-heading">Make room for your best work.</h1><p className="page-subtitle">Read text from images, reference your sources, prepare an assignment, and work through ideas.</p></div>
        <Link href="/library" className="action-secondary">Open Library</Link>
      </header>
      <nav aria-label="Academic tools" className="flex flex-wrap gap-2">
        {[['#ocr', 'Image to text'], ['#citations', 'Citations'], ['#cover', 'Cover page'], ['#complexity', 'Big-O review'], ['#whiteboard', 'Whiteboard']].map(([href, label]) => <a key={href} href={href} className="action-secondary">{label}</a>)}
      </nav>
      <div className="grid items-start gap-6 lg:grid-cols-2"><ClientOcr /><CoverPdf /></div>
      <CitationForm />
      <CodeReview />
      <Whiteboard />
    </main>
  );
}
