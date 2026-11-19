'use client';

import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { CoverBuilder } from '@/components/cover-builder';
import { BibliographyWorkspace } from '@/components/bibliography-workspace';
import { BoardLearningPreview, readBoardGraphHandoff } from '@/components/board-learning-preview';
import { insertConceptIntoTldraw } from '@/lib/concept-graph-board';
import { boardStorageKeys, clearLocalBoard, loadLocalBoard, saveLocalBoard } from '@/lib/local-boards';
import { Tldraw, getSnapshot, loadSnapshot, type Editor } from 'tldraw';
import { z } from 'zod';
import 'tldraw/tldraw.css';

const baseUrl = () => process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';
const inputClass = 'w-full rounded border border-[var(--line)] bg-white px-3 py-2 text-sm';
const labelClass = 'mb-1.5 block text-xs font-semibold text-[var(--ink)]';
const reviewSchema = z.object({
  time_complexity: z.string(),
  space_complexity: z.string(),
  explanation: z.string(),
  improvements: z.array(z.string()),
});

function serviceError(status: number, tool: string) {
  if (status === 401 || status === 403)
    return 'Your session could not be verified. Sign in again, then retry.';
  if (status === 429) return 'You have reached the current request limit. Please try again later.';
  return `${tool} is unavailable right now (HTTP ${status}). Please retry in a moment.`;
}

function failureMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError) return `${fallback} Check your connection, then retry.`;
  return error instanceof Error ? error.message : fallback;
}

function Whiteboard() {
  const { isLoaded, userId, getToken } = useAuth();
  if (!isLoaded || !userId) {
    return (
      <p id="whiteboard" role="status" className="surface surface-padded">
        Loading your whiteboard account.
      </p>
    );
  }
  return <AccountWhiteboard key={userId} ownerId={userId} getToken={getToken} />;
}

function AccountWhiteboard({
  ownerId,
  getToken,
}: {
  ownerId: string;
  getToken: () => Promise<string | null>;
}) {
  const searchParams = useSearchParams();
  const handoff = readBoardGraphHandoff(searchParams);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = () => {
    if (!editor) return;
    try {
      saveLocalBoard(ownerId, JSON.stringify(getSnapshot(editor.store)));
      setSaved(true);
      setError('');
    } catch {
      setError(
        'Could not save this board. Your browser may have disabled local storage or run out of space.',
      );
    }
  };
  const load = () => {
    if (!editor) return;
    try {
      const raw = loadLocalBoard(ownerId);
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
    try {
      clearLocalBoard(ownerId);
      editor?.selectAll();
      editor?.deleteShapes(editor.getSelectedShapeIds());
      setSaved(false);
      setError('');
    } catch {
      setError('Could not clear the saved board. Your current drawing is still open.');
    }
  };

  return (
    <section id="whiteboard" className="surface surface-padded scroll-mt-20">
      <BoardLearningPreview
        ownerId={ownerId}
        getToken={getToken}
        handoff={handoff}
        onInsert={(target, revision) => {
          if (!editor) throw new Error('The whiteboard is still loading. Try again once it is ready.');
          insertConceptIntoTldraw(editor, target, revision);
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-heading">Think on a whiteboard</h2>
          <p className="section-caption">
            Sketch a diagram or work through a problem. Boards stay in this browser.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={!editor} className="action-secondary disabled:opacity-50">
            Save
          </button>
          <button onClick={load} disabled={!editor} className="action-secondary disabled:opacity-50">
            Load
          </button>
          <button onClick={clear} disabled={!editor} className="action-secondary disabled:opacity-50">
            Clear
          </button>
        </div>
      </div>
      <div
        className="relative mt-4 h-[min(65vh,560px)] min-h-[360px] overflow-hidden rounded border border-[var(--line)]"
        aria-label="Whiteboard canvas"
      >
        <Tldraw onMount={setEditor} persistenceKey={boardStorageKeys(ownerId).persistence} />
      </div>
      {saved && (
        <p role="status" className="mt-3 text-xs text-[var(--forest)]">
          Saved in this browser.
        </p>
      )}
      {error && (
        <p role="alert" className="status-error mt-3">
          {error}
        </p>
      )}
    </section>
  );
}

function CoverPdf() {
  const { isLoaded, userId } = useAuth();
  return (
    <div id="cover" className="scroll-mt-20">
      <CoverBuilder
        key={isLoaded ? (userId ?? 'signed-out') : 'auth-loading'}
        ownerId={isLoaded ? (userId ?? null) : null}
      />
    </div>
  );
}

function ClientOcr() {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('eng');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const run = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file. For a PDF, upload it to your Library instead.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('Choose an image that is 15 MB or smaller.');
      return;
    }
    setBusy(true);
    setText('');
    setError('');
    setProgress(0);
    let worker: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | undefined;
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
      if (!data.text.trim())
        setError('No text was found. Try a sharper image and check the selected language.');
      setText(data.text);
    } catch {
      setError(
        'Could not read this image. Check your connection so the OCR language files can load, then try a clear JPG or PNG.',
      );
    } finally {
      try {
        await worker?.terminate();
      } catch {
        setError(
          (current) =>
            current ||
            'OCR finished, but could not release its browser resources. Refresh before trying another image.',
        );
      }
      setBusy(false);
    }
  };

  return (
    <section id="ocr" className="surface surface-padded scroll-mt-20">
      <p className="page-kicker">FROM IMAGE TO NOTES</p>
      <h2 className="section-heading">English & Bangla OCR</h2>
      <p className="section-caption">
        Extract text from an image in your browser. Review the result before using it.
      </p>
      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="ocr-language" className={labelClass}>
            Text language
          </label>
          <select
            id="ocr-language"
            value={language}
            disabled={busy}
            onChange={(event) => setLanguage(event.target.value)}
            className={inputClass}
          >
            <option value="eng">English</option>
            <option value="ben">Bangla</option>
            <option value="both">English + Bangla</option>
          </select>
        </div>
        <div>
          <label htmlFor="ocr-image" className={labelClass}>
            Choose an image
          </label>
          <input
            id="ocr-image"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void run(file);
              event.target.value = '';
            }}
            className="w-full text-xs file:mr-3 file:rounded file:border file:border-[var(--line)] file:bg-[var(--mint)] file:px-3 file:py-2 file:text-[var(--forest)]"
          />
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            Images up to 15 MB. Language files download on first use. For PDF chapters, use your{' '}
            <Link href="/library" className="font-semibold text-[var(--forest)] underline">
              Library
            </Link>
            .
          </p>
        </div>
        {busy && (
          <div role="status" className="text-xs text-[var(--forest)]">
            <p>{progress === 0 ? 'Preparing OCR...' : `Reading image: ${progress}%`}</p>
            <progress
              value={progress}
              max={100}
              aria-label="Image recognition progress"
              className="mt-2 h-2 w-full accent-[var(--forest)]"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="status-error">
            {error}
          </p>
        )}
        {text && (
          <div>
            <label htmlFor="ocr-result" className={labelClass}>
              Extracted text
            </label>
            <textarea
              id="ocr-result"
              readOnly
              value={text}
              className={`${inputClass} min-h-44 resize-y leading-relaxed`}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function CitationForm() {
  const { isLoaded, userId } = useAuth();
  return (
    <div id="citations" className="scroll-mt-20">
      {isLoaded && userId ? (
        <BibliographyWorkspace key={userId} />
      ) : (
        <p role="status" className="surface surface-padded">
          Loading your bibliography account.
        </p>
      )}
    </div>
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
      <p className="section-caption">
        Explore time and space complexity with an AI explanation. This tool reviews code without executing it.
      </p>
      <form onSubmit={(event) => void analyze(event)} className="mt-5 space-y-4">
        <div className="max-w-xs">
          <label htmlFor="code-language" className={labelClass}>
            Code language
          </label>
          <select
            id="code-language"
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
              setReview(null);
            }}
            className={inputClass}
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor="code-input" className={labelClass}>
            Code to review
          </label>
          <textarea
            id="code-input"
            required
            maxLength={6000}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setReview(null);
            }}
            placeholder="Paste the algorithm you want to understand..."
            className={`${inputClass} min-h-52 resize-y font-mono text-xs leading-relaxed`}
          />
          <p className="mt-1.5 text-right text-xs text-[var(--muted)]">
            {code.length.toLocaleString()} / 6,000 characters
          </p>
        </div>
        {error && (
          <p role="alert" className="status-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="action-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Reviewing complexity...' : 'Analyse complexity'}
        </button>
      </form>
      {review && (
        <div className="mt-5 rounded border border-[var(--line)] bg-[var(--mint)] p-4" role="status">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <p className="text-xs text-[var(--muted)]">Time complexity</p>
              <p className="mt-1 font-mono text-lg font-semibold text-[var(--forest)]">
                {review.time_complexity}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)]">Space complexity</p>
              <p className="mt-1 font-mono text-lg font-semibold text-[var(--forest)]">
                {review.space_complexity}
              </p>
            </div>
          </div>
          <MarkdownRenderer markdown={review.explanation} className="mt-4 text-sm leading-relaxed" />
          {review.improvements.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold">Ways to improve</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                {review.improvements.map((improvement, index) => (
                  <li key={index}>
                    <MarkdownRenderer markdown={improvement} className="text-sm leading-relaxed" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function ToolsPage() {
  return (
    <main className="workspace-page space-y-6">
      <header className="page-heading-row flex-wrap">
        <div>
          <p className="page-kicker">ACADEMIC TOOLKIT</p>
          <h1 className="page-heading">Make room for your best work.</h1>
          <p className="page-subtitle">
            Read text from images, reference your sources, prepare an assignment, and work through ideas.
          </p>
        </div>
        <Link href="/library" className="action-secondary">
          Open Library
        </Link>
      </header>
      <nav aria-label="Academic tools" className="flex flex-wrap gap-2">
        {[
          ['#ocr', 'Image to text'],
          ['#citations', 'Citations'],
          ['#cover', 'Cover page'],
          ['#complexity', 'Big-O review'],
          ['#whiteboard', 'Whiteboard'],
        ].map(([href, label]) => (
          <a key={href} href={href} className="action-secondary">
            {label}
          </a>
        ))}
      </nav>
      <ClientOcr />
      <CoverPdf />
      <CitationForm />
      <CodeReview />
      <Whiteboard />
    </main>
  );
}
