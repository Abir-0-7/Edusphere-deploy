'use client';

import { useEffect, useId, useState } from 'react';
import {
  LessonDraftSchema,
  type GenerationLessonEdit,
  type GenerationRun,
  type LessonDraft,
} from '@studyvault/types';
import { getLessonEdits, saveLessonEdit } from '@/lib/source-refresh-client';
import { AiHttpError, type GetToken } from '@/lib/ai-client';

const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-400 bg-white p-2 text-sm text-slate-950';
const button =
  'rounded-lg border border-emerald-800 bg-white px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50';
const fields = [
  ['title', 'Lesson title', 200],
  ['explanation', 'Explanation', 6000],
  ['worked_example', 'Worked example', 3000],
  ['question', 'Practice question', 1000],
  ['answer', 'Suggested answer', 1500],
] as const;

export function GenerationLessonEditor({
  getToken,
  run,
  objectiveId,
  original,
  onSaved,
}: {
  getToken: GetToken;
  run: GenerationRun;
  objectiveId: string;
  original: LessonDraft;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t pt-3">
      <button className={button} type="button" onClick={() => setOpen((value) => !value)}>
        {open ? 'Close private lesson editor' : 'Open private lesson editor'}
      </button>
      {open ? (
        <Editor
          key={`${run.id}:${objectiveId}`}
          getToken={getToken}
          run={run}
          objectiveId={objectiveId}
          original={original}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}

function Editor({
  getToken,
  run,
  objectiveId,
  original,
  onSaved,
}: {
  getToken: GetToken;
  run: GenerationRun;
  objectiveId: string;
  original: LessonDraft;
  onSaved: () => Promise<void>;
}) {
  const [history, setHistory] = useState<GenerationLessonEdit[]>([]);
  const [draft, setDraft] = useState(original);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fieldId = useId();
  const objective = run.plan.objectives.find((item) => item.id === objectiveId);

  useEffect(() => {
    let valid = true;
    void getLessonEdits(getToken, run.id)
      .then((data) => {
        if (!valid) return;
        const edits = data.items.filter((item) => item.objective_id === objectiveId);
        const latest = edits.at(-1);
        setHistory(edits);
        setRevision(latest?.revision ?? 0);
        if (latest) setDraft(latest.output);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!valid) return;
        if (cause instanceof AiHttpError && cause.status === 404) setUnavailable(true);
        else setError(cause instanceof Error ? cause.message : 'Could not load private lesson edits.');
      });
    return () => {
      valid = false;
    };
  }, [getToken, run.id, objectiveId]);

  if (unavailable)
    return <p className="mt-2 text-sm">Private lesson editing is not available in this environment yet.</p>;
  return (
    <section
      className="mt-3 min-w-0 space-y-3 rounded-lg border bg-slate-50 p-3"
      aria-label={`Private lesson editor ${objectiveId}`}
    >
      <p className="font-semibold">Saved personal version · revision {revision}</p>
      <p className="text-sm">
        Edits are separate from the immutable generated draft. Saving retains prior versions and does not
        approve or publish this lesson.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-900">
          {error} Local text is retained.
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-emerald-900">
          {notice}
        </p>
      ) : null}
      {fields.map(([key, label, maximum]) => (
        <div key={key}>
          <label htmlFor={`${fieldId}-${key}`} className="block text-sm font-medium">
            {label}
          </label>
          <textarea
            id={`${fieldId}-${key}`}
            className={field}
            rows={key === 'title' ? 2 : 4}
            maxLength={maximum}
            value={draft[key]}
            disabled={busy || !loaded}
            onChange={(event) => {
              setDraft((current) => ({ ...current, [key]: event.target.value }));
              setDirty(true);
            }}
          />
        </div>
      ))}
      <fieldset className="space-y-2 border p-2">
        <legend className="px-1 text-sm font-medium">Approved evidence used by this personal version</legend>
        {objective?.evidence.map((pin, index) => {
          const id = `pin-${index + 1}` as LessonDraft['evidence_ids'][number];
          return (
            <label key={id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.evidence_ids.includes(id)}
                disabled={busy || !loaded}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    evidence_ids: event.target.checked
                      ? [...current.evidence_ids, id]
                      : current.evidence_ids.filter((value) => value !== id),
                  }));
                  setDirty(true);
                }}
              />
              <span className="min-w-0 break-words">
                <strong>{id}</strong>: {pin.quote}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="text-xs text-slate-600">
        {dirty ? 'Unsaved personal edits.' : 'No unsaved personal edits.'} Up to five saved versions per
        objective.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={
            busy || !loaded || !dirty || !LessonDraftSchema.safeParse(draft).success || history.length >= 5
          }
          onClick={() => {
            setBusy(true);
            setError('');
            setNotice('');
            void saveLessonEdit(getToken, run, objectiveId, revision, draft)
              .then(async (edit) => {
                setHistory((current) => [...current, edit]);
                setRevision(edit.revision);
                setDirty(false);
                setNotice(
                  'Personal lesson version saved. The original draft and prior edits remain available.',
                );
                await onSaved();
              })
              .catch((cause: unknown) =>
                setError(
                  cause instanceof Error ? cause.message : 'Could not save the personal lesson version.',
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Save personal lesson version
        </button>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void getLessonEdits(getToken, run.id)
              .then(async (data) => {
                const edits = data.items.filter((item) => item.objective_id === objectiveId),
                  latest = edits.at(-1);
                setHistory(edits);
                setRevision(latest?.revision ?? 0);
                setLoaded(true);
                if (!dirty) setDraft(latest?.output ?? original);
                setNotice(
                  dirty
                    ? 'Latest revision loaded. Local text retained; saving will create a new version from this text.'
                    : 'Saved personal version refreshed.',
                );
                await onSaved();
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Could not refresh saved lesson edits.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          Refresh saved lesson history
        </button>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">
          Inspect prior personal versions ({history.length})
        </summary>
        {!history.length ? (
          <p className="mt-2">No personal versions saved yet.</p>
        ) : (
          history.map((edit) => (
            <article key={edit.revision} className="mt-2 rounded border bg-white p-2">
              <p className="font-medium">
                Revision {edit.revision} · {edit.created_at}
              </p>
              {edit.copied_from_run_id ? (
                <p className="break-all text-xs">
                  Retained from run {edit.copied_from_run_id}, revision {edit.copied_from_revision}
                </p>
              ) : null}
              <p className="mt-1 font-medium">{edit.output.title}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{edit.output.explanation}</p>
            </article>
          ))
        )}
      </details>
    </section>
  );
}
