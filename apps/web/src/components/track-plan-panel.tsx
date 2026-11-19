'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TrackIdSchema,
  type TrackCatalogResponse,
  type TrackChangePreview,
  type TrackId,
  type TrackPlanHistoryResponse,
} from '@studyvault/types';
import type { GetToken } from '@/lib/ai-client';
import {
  applyTrackChange,
  getTrackHistory,
  getTrackOptions,
  previewTrackChange,
} from '@/lib/track-plan-client';

const courseNames = {
  'python-foundations': 'Python Foundations',
  'pytorch-fundamentals': 'PyTorch Fundamentals',
};
const objectiveNames: Readonly<Record<string, string>> = {
  'py-values-objective': 'Trace values and expressions',
  'py-branches-objective': 'Choose the first true branch',
  'py-loops-objective': 'Trace a list accumulator',
  'py-functions-objective': 'Use parameters and return values',
  'py-records-objective': 'Filter and aggregate records',
  'pt-tensors-objective': 'Describe tensor shape and metadata',
  'pt-reshape-objective': 'Reason about reshaping and indexing',
  'pt-broadcast-objective': 'Predict broadcast shapes',
  'pt-autograd-objective': 'Separate gradients from updates',
  'pt-training-objective': 'Trace a training step and evaluation',
};
const button = 'rounded bg-blue-700 px-3 py-2 font-medium text-white disabled:opacity-50';
const outline = 'rounded border border-neutral-500 px-3 py-2 disabled:opacity-50';

export function TrackPlanPanel({
  getToken,
  onTrackChange,
}: {
  getToken: GetToken;
  onTrackChange?: () => void;
}) {
  const [options, setOptions] = useState<TrackCatalogResponse | null>(null);
  const [selected, setSelected] = useState<TrackId | null>(null);
  const [preview, setPreview] = useState<TrackChangePreview | null>(null);
  const [history, setHistory] = useState<TrackPlanHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getTrackOptions(getToken)
      .then((value) => {
        if (!active) return;
        setOptions(value);
        setSelected(value.current_track_id);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load your learning tracks.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [getToken, reload]);

  async function act(operation: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your learning track.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const current = options?.tracks.find((track) => track.id === options.current_track_id);
  const target = options?.tracks.find((track) => track.id === selected);
  const canPreview =
    selected !== null && (selected !== options?.current_track_id || options.current_revision === 0);

  return (
    <section className="space-y-4 rounded border p-4 sm:p-5" aria-labelledby="learning-track-title">
      <div>
        <h2 id="learning-track-title" className="text-lg font-semibold">
          Learning track
        </h2>
        <p>Preview changes to your study requirements before saving a new plan.</p>
      </div>
      {loading && <p role="status">Loading learning tracks.</p>}
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-green-800">
          {message}
        </p>
      )}
      {!loading && !options && (
        <button
          type="button"
          className={outline}
          onClick={() => {
            setError(null);
            setReload((v) => v + 1);
          }}
        >
          Retry loading tracks
        </button>
      )}
      {options && !loading && (
        <>
          <p>
            <strong>Current track:</strong> {current?.title} ·{' '}
            {options.current_revision
              ? `plan revision ${options.current_revision}`
              : 'suggested starting plan'}
          </p>
          <label className="block">
            Track to preview
            <select
              className="mt-1 block w-full rounded border border-neutral-400 p-2"
              value={selected ?? ''}
              disabled={pending}
              onChange={(event) => {
                const parsed = TrackIdSchema.safeParse(event.target.value);
                if (!parsed.success) return;
                setSelected(parsed.data);
                setPreview(null);
                setError(null);
                setMessage(null);
              }}
            >
              {options.tracks.map((track) => (
                <option value={track.id} key={track.id}>
                  {track.title}
                </option>
              ))}
            </select>
          </label>
          {target && <p>{target.description}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={pending || !canPreview || !selected}
              onClick={() => {
                if (selected) void act(async () => setPreview(await previewTrackChange(getToken, selected)));
              }}
            >
              Preview track change
            </button>
            <button
              type="button"
              className={outline}
              disabled={pending}
              onClick={() => void act(async () => setHistory(await getTrackHistory(getToken)))}
            >
              View plan history
            </button>
          </div>
        </>
      )}
      {preview && (
        <section className="space-y-3 rounded border bg-neutral-50 p-3" aria-labelledby="track-preview-title">
          <h3 id="track-preview-title" className="font-semibold">
            Proposed plan revision {preview.plan_revision}
          </h3>
          <p>{preview.notice}</p>
          <p>
            <strong>Next study action:</strong> Recalculated from your progress after saving the plan.
          </p>
          <p>
            <strong>Course versions:</strong> {preview.pinned_releases.length} existing enrollment(s) stay
            pinned.
          </p>
          <p>
            <strong>Course requirements:</strong>{' '}
            {preview.added_course_slugs.length === 0 && preview.removed_course_slugs.length === 0
              ? 'Unchanged.'
              : [
                  ...preview.added_course_slugs.map((slug) => `Add ${courseNames[slug]}`),
                  ...preview.removed_course_slugs.map((slug) => `Remove ${courseNames[slug]}`),
                ].join('; ')}
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {preview.objective_mapping.map((row) => (
              <li key={row.objective_id}>
                {objectiveNames[row.objective_id] ?? row.objective_id}
                {' — '}
                {row.status === 'new_requirement'
                  ? 'new requirement'
                  : row.status === 'no_longer_required'
                    ? 'no longer required'
                    : 'shared requirement'}
                {row.completed && '; completed work kept'}
                {row.attempts_preserved > 0 && `; ${row.attempts_preserved} recent attempt(s) mapped`}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={button}
            disabled={pending}
            onClick={() =>
              void act(async () => {
                const applied = await applyTrackChange(getToken, preview);
                setPreview(null);
                setHistory(null);
                setOptions(
                  (value) =>
                    value && {
                      ...value,
                      current_track_id: applied.track_id,
                      current_revision: applied.revision,
                    },
                );
                setMessage(
                  `Plan revision ${applied.revision} saved. Course versions and attempts are unchanged.`,
                );
                onTrackChange?.();
              })
            }
          >
            Apply this plan revision
          </button>
        </section>
      )}
      {history && (
        <section className="space-y-2" aria-labelledby="track-history-title">
          <h3 id="track-history-title" className="font-semibold">
            Past plan revisions
          </h3>
          {history.history.length === 0 && <p>No saved plan revisions yet.</p>}
          <ol className="space-y-1">
            {history.history.map((item) => (
              <li key={item.revision}>
                Revision {item.revision} —{' '}
                {options?.tracks.find((track) => track.id === item.track_id)?.title}
              </li>
            ))}
          </ol>
          {history.next_before_revision !== null && (
            <button
              type="button"
              className={outline}
              disabled={pending}
              onClick={() =>
                void act(async () => {
                  const page = await getTrackHistory(getToken, history.next_before_revision ?? undefined);
                  setHistory({ ...page, history: [...history.history, ...page.history] });
                })
              }
            >
              Load earlier revisions
            </button>
          )}
        </section>
      )}
    </section>
  );
}
