'use client';

import { useEffect, useRef, useState } from 'react';
import type { CodeReviewResponse } from '@studyvault/types';
import type { GetToken } from '@/lib/ai-client';
import { codeReviewNote, requestCodeReview } from '@/lib/code-review-client';
import { CourseNoteHandoff } from './course-note-handoff';
import { MarkdownRenderer } from './markdown-renderer';

export function CodeReviewWorkspace({ getToken, ownerId }: { getToken: GetToken; ownerId: string }) {
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('python');
  const [context, setContext] = useState('');
  const [reference, setReference] = useState('');
  const [review, setReview] = useState<CodeReviewResponse | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      sequence.current++;
      controller.current?.abort();
    },
    [],
  );

  function invalidate() {
    sequence.current++;
    controller.current?.abort();
    setBusy(false);
    setReview(null);
    setNote('');
    setError('');
  }

  async function analyze() {
    const request = ++sequence.current;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setError('');
    const input = { code, language, context, reference };
    try {
      const result = await requestCodeReview(getToken, { code, language, context }, pending.signal);
      if (sequence.current !== request || pending.signal.aborted) return;
      setReview(result);
      setNote(codeReviewNote(input, result));
    } catch (cause) {
      if (sequence.current !== request || pending.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Could not review this code.');
    } finally {
      if (sequence.current === request) setBusy(false);
    }
  }

  const field = 'mt-1 block w-full rounded border border-slate-500 px-3 py-2 text-sm';
  const button =
    'rounded border border-blue-700 px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50';
  const tooLong = Array.from(note).length > 5000;
  return (
    <section aria-labelledby="code-review-title" className="space-y-3 rounded border p-4">
      <h2 id="code-review-title" className="font-semibold">
        Big-O reviewer
      </h2>
      <p className="text-sm text-slate-700">
        Review a static estimate with its assumptions and reasoning. Your code is not executed. Runtime
        measurements on finite inputs do not prove Big-O.
      </p>
      <label className="block text-sm">
        Code language
        <select
          value={language}
          className={field}
          onChange={(event) => {
            invalidate();
            setLanguage(event.target.value);
          }}
        >
          {['python', 'javascript', 'typescript', 'other'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Code to review
        <textarea
          value={code}
          maxLength={6000}
          rows={8}
          spellCheck={false}
          className={`${field} font-mono`}
          onChange={(event) => {
            invalidate();
            setCode(event.target.value);
          }}
        />
      </label>
      <label className="block text-sm">
        Input sizes and helper costs (optional)
        <textarea
          value={context}
          maxLength={1500}
          rows={3}
          className={field}
          placeholder="For example: n is the number of items; lookup uses a hash table; compare worst case."
          onChange={(event) => {
            invalidate();
            setContext(event.target.value);
          }}
        />
      </label>
      <label className="block text-sm">
        Reference for your lesson note (optional)
        <textarea
          value={reference}
          maxLength={1000}
          rows={2}
          className={field}
          placeholder="Book/page, lesson or source URL you supplied; this reference is not independently verified."
          onChange={(event) => {
            invalidate();
            setReference(event.target.value);
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={busy || !code.trim()}
          onClick={() => void analyze()}
        >
          {busy ? 'Analysing…' : 'Analyse'}
        </button>
        {busy ? (
          <button
            type="button"
            className={button}
            onClick={() => {
              sequence.current++;
              controller.current?.abort();
              setBusy(false);
              setError('Review cancelled. Your code is preserved.');
            }}
          >
            Cancel review
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {review ? (
        <div className="space-y-3 rounded bg-slate-50 p-3 text-sm" aria-label="Code review result">
          <p>
            <strong>Estimated time:</strong> {review.time_complexity} · <strong>Estimated space:</strong>{' '}
            {review.space_complexity}
          </p>
          <MarkdownRenderer markdown={review.explanation} />
          <h3 className="font-semibold">Assumptions</h3>
          <ul className="list-disc space-y-1 pl-5">
            {review.assumptions.map((item, index) => (
              <li key={index}>
                <MarkdownRenderer markdown={item} />
              </li>
            ))}
          </ul>
          <h3 className="font-semibold">Reasoning steps</h3>
          <ol className="list-decimal space-y-1 pl-5">
            {review.steps.map((item, index) => (
              <li key={index}>
                <MarkdownRenderer markdown={item} />
              </li>
            ))}
          </ol>
          {review.notes.length ? (
            <>
              <h3 className="font-semibold">Line notes</h3>
              <ul>
                {review.notes.map((item, index) => (
                  <li key={index}>
                    <strong>{item.line === null ? 'General' : `Line ${item.line}`}:</strong>{' '}
                    <MarkdownRenderer markdown={item.note} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {review.improvements.length ? (
            <>
              <h3 className="font-semibold">Possible improvements</h3>
              <ul className="list-disc pl-5">
                {review.improvements.map((item, index) => (
                  <li key={index}>
                    <MarkdownRenderer markdown={item} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <label className="block">
            Lesson note draft
            <textarea
              className={field}
              rows={8}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <p>
            {Array.from(note).length.toLocaleString()} / 5,000 characters. Edit the draft before saving to a
            lesson.
          </p>
          {tooLong ? (
            <p role="alert">Shorten this draft to 5,000 characters before choosing a course note.</p>
          ) : note.trim() ? (
            <CourseNoteHandoff key={`${ownerId}:${note}`} ownerId={ownerId} getToken={getToken} text={note} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
