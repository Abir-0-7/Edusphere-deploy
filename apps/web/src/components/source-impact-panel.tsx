'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  GenerationRun,
  OutlineRecord,
  OutlineSourceSummary,
  RefreshPreview,
  RefreshPreviewRequest,
  SourceImpactResponse,
  SourceLocator,
} from '@studyvault/types';
import { AiHttpError, type GetToken } from '@/lib/ai-client';
import { listOutlineSources } from '@/lib/course-outline-client';
import {
  previewGenerationRefresh,
  previewSourceImpact,
  startGenerationRefresh,
} from '@/lib/source-refresh-client';

const button =
  'rounded-lg border border-emerald-800 bg-white px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50';
const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-400 bg-white p-2 text-sm text-slate-950';
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Source review is temporarily unavailable.';
const label = (value: string) => value.replaceAll('_', ' ');
function location(locator: SourceLocator | null) {
  if (!locator) return 'Absent';
  if (locator.kind === 'pdf') {
    return `PDF page ${locator.pdf_page_index}${locator.printed_page_label ? `, printed ${locator.printed_page_label}` : ''}`;
  }
  if (locator.kind === 'text') return `Text lines ${locator.start_line}–${locator.end_line}`;
  const cell = locator.notebook_cell
    ? `, cell ${locator.notebook_cell.index} (${locator.notebook_cell.cell_type})`
    : '';
  return `${locator.path}${cell}, lines ${locator.start_line}–${locator.end_line}`;
}

export function SourceImpactPanel({ getToken, run }: { getToken: GetToken; run: GenerationRun }) {
  const [sources, setSources] = useState<OutlineSourceSummary[]>([]);
  const [sourceTotal, setSourceTotal] = useState(0);
  const [oldId, setOldId] = useState('');
  const [newId, setNewId] = useState('');
  const [impact, setImpact] = useState<SourceImpactResponse | null>(null);
  const [pages, setPages] = useState<SourceImpactResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const current = impact?.old_version_id === oldId && impact.new_version_id === newId ? impact : null;
  const latestPage = pages.at(-1) ?? current;
  const artifacts = current ? [current, ...pages].flatMap((page) => page.artifacts) : [];
  const segments = current ? [current, ...pages].flatMap((page) => page.segments) : [];

  useEffect(() => {
    let valid = true;
    void listOutlineSources(getToken)
      .then((data) => {
        if (valid) {
          setSources(data.items);
          setSourceTotal(data.total_count);
        }
      })
      .catch((cause: unknown) => {
        if (valid) {
          if (cause instanceof AiHttpError && cause.status === 404) setUnavailable(true);
          else setError(message(cause));
        }
      });
    return () => {
      valid = false;
    };
  }, [getToken]);

  if (unavailable)
    return <p className="mt-3 text-sm">Source impact review is not available in this environment yet.</p>;
  return (
    <section
      className="mt-4 min-w-0 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
      aria-label="Source change impact"
    >
      <h4 className="font-semibold">Review source changes</h4>
      <p className="text-sm">
        Choose the exact before and after snapshots. This preview flags linked study material; it does not
        change cards, maps, lessons or an enrollment.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-900">
          {error}
        </p>
      ) : null}
      <label className="block text-sm">
        Before source version
        <select
          value={oldId}
          disabled={busy}
          className={field}
          onChange={(event) => setOldId(event.target.value)}
        >
          <option value="">Choose before snapshot</option>
          {run.plan.sources.map((source) => (
            <option key={source.version_id} value={source.version_id}>
              {sources.find((item) => item.id === source.version_id)?.title ?? source.version_id} ·{' '}
              {source.version_id}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        After source version
        <select
          value={newId}
          disabled={busy}
          className={field}
          onChange={(event) => setNewId(event.target.value)}
        >
          <option value="">Choose after snapshot</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.title} · {source.id}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        {sources.length < sourceTotal ? (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void listOutlineSources(getToken, sources.length)
                .then((data) => {
                  setSources((current) => [...current, ...data.items]);
                  setSourceTotal(data.total_count);
                })
                .catch((cause: unknown) => setError(message(cause)))
                .finally(() => setBusy(false));
            }}
          >
            Load more source snapshots
          </button>
        ) : null}
        <button
          type="button"
          className={button}
          disabled={busy || !oldId || !newId || oldId === newId}
          onClick={() => {
            setBusy(true);
            setError('');
            void previewSourceImpact(getToken, oldId, newId)
              .then((data) => {
                setImpact(data);
                setPages([]);
              })
              .catch((cause: unknown) => {
                if (cause instanceof AiHttpError && cause.status === 404) setUnavailable(true);
                else setError(message(cause));
              })
              .finally(() => setBusy(false));
          }}
        >
          Preview source impact
        </button>
      </div>
      {current ? (
        <div
          className="space-y-3 rounded-lg border bg-white p-3"
          role="region"
          aria-label="Source impact report"
        >
          <p className="break-all text-xs">
            Before SHA-256: {current.old_content_hash}
            <br />
            After SHA-256: {current.new_content_hash}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {Object.entries(current.counts).map(([key, count]) => (
              <div key={key}>
                <dt className="capitalize">{key}</dt>
                <dd className="font-semibold">{count}</dd>
              </div>
            ))}
          </dl>
          {current.limitations.map((value) => (
            <p key={value} className="text-sm text-amber-950">
              {value}
            </p>
          ))}
          {latestPage?.segments_truncated ? (
            <p className="text-sm font-semibold">
              Load more results to review the remaining changed excerpts.
            </p>
          ) : null}
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">Inspect changed source excerpts</summary>
            <ol className="mt-2 space-y-2">
              {segments.map((segment, index) => (
                <li key={index} className="rounded border p-2">
                  <p className="font-medium capitalize">{segment.change}</p>
                  <p className="break-words text-xs">Before: {location(segment.old_locator)}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">
                    {segment.old_excerpt ?? 'No before excerpt'}
                  </p>
                  <p className="mt-2 break-words text-xs">After: {location(segment.new_locator)}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">
                    {segment.new_excerpt ?? 'No after excerpt'}
                  </p>
                </li>
              ))}
            </ol>
          </details>
          <h5 className="font-semibold">Linked material flagged for review ({current.total_artifacts})</h5>
          {latestPage?.artifacts_truncated ? (
            <p className="text-sm font-semibold">The impact scan covers a limited set of linked material.</p>
          ) : null}
          {current.total_artifacts === 0 ? (
            <p className="text-sm">
              No linked material was found in this scan. This is not a claim that every study artifact was
              checked.
            </p>
          ) : null}
          <ul className="space-y-2 text-sm">
            {artifacts.map((artifact) => (
              <li
                key={`${artifact.kind}:${artifact.parent_id}:${artifact.id}:${artifact.revision}`}
                className="rounded border p-2"
              >
                <p className="break-words font-medium">
                  {label(artifact.kind)}: {artifact.title}
                </p>
                <p>
                  Source {artifact.reason}.{' '}
                  {artifact.edited === true
                    ? 'Saved edits are present.'
                    : artifact.edited === false
                      ? 'No manual edit is recorded.'
                      : 'Edit provenance is not tracked for this item.'}
                </p>
                {artifact.document_id ? (
                  <a
                    className="mt-1 inline-block font-semibold underline"
                    href={`/document/${encodeURIComponent(artifact.document_id)}`}
                  >
                    Open linked material in library
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          {latestPage && (latestPage.segments_truncated || artifacts.length < latestPage.total_artifacts) ? (
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void previewSourceImpact(getToken, oldId, newId, latestPage.offset + latestPage.limit)
                  .then((data) => setPages((previous) => [...previous, data]))
                  .catch((cause: unknown) => setError(message(cause)))
                  .finally(() => setBusy(false));
              }}
            >
              Load more impact results
            </button>
          ) : null}
          <p className="text-sm">
            Update the evidence links in the outline editor and approve the new revision before preparing
            lesson replacements. Open the linked library item to review affected cards or maps.
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function SelectiveRefreshPanel({
  getToken,
  run,
  outline,
  hasUnsavedChanges,
  onCreated,
}: {
  getToken: GetToken;
  run: GenerationRun;
  outline: OutlineRecord | null;
  hasUnsavedChanges: boolean;
  onCreated: (run: GenerationRun) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<RefreshPreview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const action = useRef<{ hash: string; id: string } | null>(null);
  const approved =
    outline?.status === 'approved' && outline.approval && !hasUnsavedChanges ? outline.approval : null;
  const request: RefreshPreviewRequest | null =
    approved && outline
      ? {
          parent_run_id: run.id,
          expected_parent_revision: run.revision,
          target: {
            outline_id: outline.id,
            approval_id: approved.id,
            outline_revision: outline.revision,
            outline_content_hash: outline.content_hash,
          },
          regenerate_objective_ids: selected,
        }
      : null;
  const current =
    preview &&
    request &&
    preview.parent_revision === run.revision &&
    preview.target.approval_id === request.target.approval_id &&
    preview.target.outline_revision === request.target.outline_revision &&
    preview.decisions
      .filter((item) => selected.includes(item.objective_id))
      .every((item) => item.action === 'generate')
      ? preview
      : null;

  if (unavailable)
    return <p className="mt-3 text-sm">Selective lesson refresh is not available in this environment yet.</p>;
  return (
    <section className="mt-4 space-y-3 rounded-lg border bg-white p-3" aria-label="Selective lesson refresh">
      <h4 className="font-semibold">Prepare selective lesson replacements</h4>
      <p className="text-sm">
        The currently saved, approved outline is the target. Unchanged stages and their personal edit history
        can be reused; changed inputs require fresh drafts. The parent run stays available.
      </p>
      {approved && outline ? (
        <p className="text-sm">
          Target: {outline.plan.title}, approved revision {outline.revision}.
        </p>
      ) : (
        <p className="text-sm">
          Save and approve the target outline after reviewing changed evidence. Unsaved local outline edits
          cannot be used.
        </p>
      )}
      {error ? (
        <p className="text-sm text-red-900" role="alert">
          {error}
        </p>
      ) : null}
      <fieldset className="space-y-2 rounded border p-2">
        <legend className="px-1 text-sm font-medium">
          Force fresh generation for selected objectives (optional)
        </legend>
        {outline?.plan.objectives.map((objective) => (
          <label key={objective.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.includes(objective.id)}
              disabled={busy || !approved}
              onChange={(event) => {
                setSelected((current) =>
                  event.target.checked
                    ? [...current, objective.id]
                    : current.filter((id) => id !== objective.id),
                );
                setPreview(null);
                setAccepted(false);
              }}
            />
            {objective.title}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        className={button}
        disabled={busy || !request}
        onClick={() => {
          if (!request) return;
          setBusy(true);
          setError('');
          setAccepted(false);
          void previewGenerationRefresh(getToken, request)
            .then(setPreview)
            .catch((cause: unknown) => {
              if (cause instanceof AiHttpError && cause.status === 404) setUnavailable(true);
              else setError(message(cause));
            })
            .finally(() => setBusy(false));
        }}
      >
        Preview selective refresh budget
      </button>
      {current ? (
        <div
          className="space-y-3 rounded-lg border bg-slate-50 p-3"
          role="region"
          aria-label="Selective refresh preview"
        >
          <p className="font-medium">
            New work token upper bound: {current.new_work_token_ceiling.toLocaleString('en-US')}
          </p>
          <p className="text-sm">
            Parent allocation retained: {current.retained_parent_allocated_tokens.toLocaleString('en-US')}.
            Prior work is not refunded or erased.
          </p>
          <ul className="space-y-2 text-sm">
            {current.decisions.map((decision) => (
              <li key={decision.objective_id} className="rounded border bg-white p-2">
                <p className="font-medium">
                  {decision.objective_id}:{' '}
                  {decision.action === 'reuse' ? 'Reuse saved stage' : 'Generate a fresh proposal'}
                </p>
                <p>{decision.reason}</p>
                {decision.has_saved_edit ? (
                  <p className="font-medium">
                    {decision.edit_disposition === 'reused'
                      ? 'Personal edit history will be copied with the reused stage.'
                      : 'Personal edits remain in the parent. Inspect the new proposal separately; it will not overwrite that saved text.'}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={accepted}
              disabled={busy}
              className="mt-1"
              onChange={(event) => setAccepted(event.target.checked)}
            />
            I accept this bounded refresh and its retained-history policy. Create a separate private run.
          </label>
          <button
            type="button"
            className={button}
            disabled={busy || !accepted || !request}
            onClick={() => {
              if (!request || !accepted || !current) return;
              if (action.current?.hash !== current.preview_hash)
                action.current = { hash: current.preview_hash, id: crypto.randomUUID() };
              setBusy(true);
              setError('');
              void startGenerationRefresh(getToken, action.current.id, request, current)
                .then(onCreated)
                .catch((cause: unknown) => {
                  setError(message(cause));
                  if (cause instanceof AiHttpError && cause.status === 409) {
                    setPreview(null);
                    setAccepted(false);
                  }
                })
                .finally(() => setBusy(false));
            }}
          >
            Create refreshed private run
          </button>
        </div>
      ) : null}
    </section>
  );
}
