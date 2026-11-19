'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  EvidencePin,
  GenerationPreview,
  GenerationRun,
  GenerationSummary,
  OutlineRecord,
} from '@studyvault/types';
import { AiHttpError, type GetToken } from '@/lib/ai-client';
import { GenerationLessonEditor } from '@/components/generation-lesson-editor';
import { SelectiveRefreshPanel, SourceImpactPanel } from '@/components/source-impact-panel';
import {
  cancelCourseGeneration,
  getCourseGeneration,
  listCourseGenerations,
  previewCourseGeneration,
  resumeCourseGeneration,
  startCourseGeneration,
} from '@/lib/course-generation-client';

const button =
  'rounded-lg border border-emerald-800 px-3 py-2 font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 py-2 text-slate-950';
const number = (value: number) => value.toLocaleString('en-US');
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Lesson generation is temporarily unavailable.';
const merge = (previous: GenerationSummary[], incoming: GenerationSummary[]) => [
  ...new Map([...previous, ...incoming].map((item) => [item.id, item])).values(),
];
const summary = (run: GenerationRun): GenerationSummary => ({
  id: run.id,
  outline_id: run.outline_id,
  title: run.plan.title,
  status: run.status,
  completed_stages: run.stages.filter((stage) => stage.status === 'done').length,
  total_stages: run.stages.length,
  maximum_tokens: run.maximum_tokens,
  allocated_tokens: run.allocated_tokens,
  updated_at: run.updated_at,
});

function pinLocation(pin: EvidencePin) {
  if (pin.locator.kind === 'pdf')
    return `PDF position ${pin.locator.pdf_page_index}${pin.locator.printed_page_label ? `, printed ${pin.locator.printed_page_label}` : ''}`;
  if (pin.locator.kind === 'text') return `Text lines ${pin.locator.start_line}–${pin.locator.end_line}`;
  const cell = pin.locator.notebook_cell
    ? `, cell ${pin.locator.notebook_cell.index} (${pin.locator.notebook_cell.cell_type})`
    : '';
  return `${pin.locator.path}${cell}, lines ${pin.locator.start_line}–${pin.locator.end_line}`;
}

export function CourseGenerationPanel({
  getToken,
  outline,
  hasUnsavedChanges = false,
}: {
  getToken: GetToken;
  outline: OutlineRecord | null;
  hasUnsavedChanges?: boolean;
}) {
  const [initial, setInitial] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [saved, setSaved] = useState<GenerationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [choice, setChoice] = useState('');
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [preview, setPreview] = useState<GenerationPreview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [retryAccepted, setRetryAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [pollingPaused, setPollingPaused] = useState(false);
  const [sourceReviewRun, setSourceReviewRun] = useState('');
  const startId = useRef<{ hash: string; id: string } | null>(null);
  const approved = outline?.status === 'approved' && outline.approval && !hasUnsavedChanges;
  const currentPreview =
    preview &&
    approved &&
    preview.outline_id === outline.id &&
    preview.approval_id === outline.approval?.id &&
    preview.outline_revision === outline.revision &&
    preview.outline_content_hash === outline.content_hash
      ? preview
      : null;
  const active = run?.status === 'pending' || run?.status === 'running';
  const unfinished = run?.stages.filter((stage) => stage.status !== 'done') ?? [];
  const retryable =
    run &&
    (run.status === 'failed' || run.status === 'cancelled') &&
    !unfinished.some((stage) => stage.error_code === 'policy_changed') &&
    unfinished.every((stage) => stage.status === 'running' || stage.attempts < run.policy.max_stage_attempts);

  useEffect(() => {
    let valid = true;
    void listCourseGenerations(getToken)
      .then((data) => {
        if (!valid) return;
        setSaved(data.items);
        setTotal(data.total_count);
        setOffset(data.items.length);
        setInitial('ready');
      })
      .catch((cause: unknown) => {
        if (!valid) return;
        if (cause instanceof AiHttpError && cause.status === 404) setInitial('unavailable');
        else {
          setError(message(cause));
          setInitial('error');
        }
      });
    return () => {
      valid = false;
    };
  }, [getToken, attempt]);

  useEffect(() => {
    if (!run || !active || busy) return;
    let valid = true,
      pending = false,
      polls = 0;
    const id = run.id;
    const timer = setInterval(() => {
      if (pending) return;
      if (polls >= 30) {
        clearInterval(timer);
        setPollingPaused(true);
        return;
      }
      pending = true;
      polls += 1;
      void getCourseGeneration(getToken, id)
        .then((latest) => {
          if (!valid) return;
          setRun((current) => (current?.id === id && latest.revision >= current.revision ? latest : current));
          setSaved((current) =>
            current.map((item) =>
              item.id === id && latest.updated_at >= item.updated_at ? summary(latest) : item,
            ),
          );
        })
        .catch((cause: unknown) => {
          if (valid) {
            setError(message(cause));
            setPollingPaused(true);
            clearInterval(timer);
          }
        })
        .finally(() => {
          pending = false;
        });
    }, 2000);
    return () => {
      valid = false;
      clearInterval(timer);
    };
  }, [run?.id, active, getToken, busy]);

  async function operate(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await action();
    } catch (cause: unknown) {
      setError(
        cause instanceof AiHttpError && cause.status === 409
          ? `${cause.message} Refresh saved progress before trying again; completed drafts are still retained.`
          : message(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshSaved() {
    const data = await listCourseGenerations(getToken);
    setSaved((current) =>
      data.items.map((item) => {
        const prior = current.find((entry) => entry.id === item.id);
        return prior && prior.updated_at > item.updated_at ? prior : item;
      }),
    );
    setTotal(data.total_count);
    setOffset(data.items.length);
  }

  function showRun(latest: GenerationRun) {
    setRun(latest);
    setChoice(latest.id);
    setRetryAccepted(false);
    setPollingPaused(false);
    setSaved((current) => {
      const previous = current.find((item) => item.id === latest.id);
      return previous && previous.updated_at > latest.updated_at
        ? current
        : merge(current, [summary(latest)]);
    });
  }

  async function openRefresh(latest: GenerationRun) {
    showRun(latest);
    setNotice('Refreshed private run created. The parent run is still in saved lesson drafts.');
    try {
      await refreshSaved();
    } catch (cause) {
      setError(message(cause));
    }
  }

  if (initial === 'unavailable')
    return (
      <section className="mt-6 rounded-xl border bg-white p-4" aria-label="Private lesson generation">
        <h3 className="font-semibold">Generate private lesson drafts</h3>
        <p className="mt-2 text-sm text-slate-700">
          Private lesson generation is not available in this environment yet.
        </p>
      </section>
    );

  return (
    <section
      className="mt-6 min-w-0 rounded-xl border border-emerald-200 bg-white p-4"
      aria-label="Private lesson generation"
      aria-busy={busy}
    >
      <h3 className="text-lg font-semibold">Generate private lesson drafts</h3>
      <p className="mt-2 text-sm text-slate-700">
        Generate one objective at a time from its approved evidence excerpts. Every result remains private and
        needs editorial review.
      </p>
      {error ? (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-sm text-emerald-900" role="status">
          {notice}
        </p>
      ) : null}
      {initial === 'error' ? (
        <button
          type="button"
          className={`${button} mt-3`}
          onClick={() => {
            setError(null);
            setInitial('loading');
            setAttempt((value) => value + 1);
          }}
        >
          Retry loading lesson drafts
        </button>
      ) : null}
      {initial === 'loading' ? <p className="mt-3 text-sm">Loading saved lesson drafts…</p> : null}
      {initial === 'ready' ? (
        <>
          <div className="mt-4 rounded-lg border bg-slate-50 p-3">
            <p className="text-sm">
              {approved
                ? `Ready to preview approved outline revision ${outline.revision}.`
                : 'Save and approve the exact outline revision before previewing generation. Save any local edits first.'}
            </p>
            <button
              type="button"
              className={`${button} mt-3`}
              disabled={busy || !approved}
              onClick={() =>
                void operate(async () => {
                  if (!outline?.approval || !approved) return;
                  const next = await previewCourseGeneration(getToken, {
                    outline_id: outline.id,
                    approval_id: outline.approval.id,
                    outline_revision: outline.revision,
                    outline_content_hash: outline.content_hash,
                  });
                  setPreview(next);
                  setAccepted(false);
                })
              }
            >
              Preview generation budget
            </button>
            {currentPreview ? (
              <div className="mt-4 space-y-3" role="region" aria-label="Generation budget preview">
                <p className="font-medium">
                  {currentPreview.stages.length} lesson stages · maximum{' '}
                  {number(currentPreview.maximum_tokens)} token upper bound
                </p>
                <p className="text-sm">
                  This conservative bound includes up to {currentPreview.policy.max_stage_attempts} logical
                  attempts per stage and {currentPreview.policy.max_provider_attempts} provider requests per
                  attempt. It is not actual token usage or a price. Existing daily quotas and capacity limits
                  still apply.
                </p>
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium">Inspect bounded stages</summary>
                  <ol className="mt-2 list-inside list-decimal space-y-1">
                    {currentPreview.stages.map((stage) => (
                      <li key={stage.id} className="break-words">
                        {stage.title}: {number(stage.input_bytes)} input bytes,{' '}
                        {number(stage.token_upper_bound)} tokens per logical attempt
                      </li>
                    ))}
                  </ol>
                </details>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={accepted}
                    disabled={busy}
                    onChange={(event) => setAccepted(event.target.checked)}
                    className="mt-1"
                  />
                  I accept this generation budget and understand the drafts need review.
                </label>
                <button
                  type="button"
                  className={button}
                  disabled={busy || !accepted}
                  onClick={() =>
                    void operate(async () => {
                      if (!accepted || !currentPreview) return;
                      if (startId.current?.hash !== currentPreview.preview_hash)
                        startId.current = { hash: currentPreview.preview_hash, id: crypto.randomUUID() };
                      const next = await startCourseGeneration(getToken, startId.current.id, currentPreview);
                      showRun(next);
                      setAccepted(false);
                      setNotice('Private generation queued. Completed stages will be saved as they finish.');
                      await refreshSaved();
                    })
                  }
                >
                  Start private lesson generation
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-lg border p-3">
            <label className="block text-sm">
              Saved lesson generation
              <select
                className={field}
                value={choice}
                disabled={busy}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value="">Choose a saved run</option>
                {saved.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} — {item.completed_stages}/{item.total_stages} stages, {item.status}
                  </option>
                ))}
              </select>
            </label>
            {!saved.length ? (
              <p className="mt-2 text-sm text-slate-700">No saved lesson drafts yet.</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={button}
                disabled={busy || !choice}
                onClick={() => void operate(async () => showRun(await getCourseGeneration(getToken, choice)))}
              >
                Open saved lesson drafts
              </button>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void operate(refreshSaved)}
              >
                Refresh saved runs
              </button>
              {offset < total ? (
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void operate(async () => {
                      const data = await listCourseGenerations(getToken, offset);
                      setSaved((current) => merge(current, data.items));
                      setTotal(data.total_count);
                      setOffset(offset + data.items.length);
                    })
                  }
                >
                  Load more generation runs
                </button>
              ) : null}
            </div>
          </div>

          {run ? (
            <div className="mt-4 min-w-0 space-y-3" role="region" aria-label="Saved generation progress">
              <h4 className="break-words font-semibold">{run.plan.title}</h4>
              <p className="text-sm">
                Approved outline revision {run.outline_revision} · Private · Editorial: not reviewed
              </p>
              <p className="font-medium">
                Generation {run.status}: {run.stages.filter((stage) => stage.status === 'done').length}/
                {run.stages.length} stages saved
              </p>
              <progress
                aria-label="Saved lesson stages"
                value={run.stages.filter((stage) => stage.status === 'done').length}
                max={run.stages.length}
                className="w-full accent-emerald-800"
              />
              <p className="text-sm">
                Allocated token upper bound: {number(run.allocated_tokens)} / {number(run.maximum_tokens)}.
                Allocation includes prior attempts and stays retained after cancellation or uncertain provider
                work. Actual usage is recorded separately by the AI router.
              </p>
              {run.parent_run_id ? (
                <p className="text-sm">
                  This private run uses the reviewed refresh. The original run is saved separately.
                </p>
              ) : null}
              {active ? (
                <p className="text-sm">
                  {pollingPaused
                    ? 'Automatic refresh paused. Refresh saved progress to check again.'
                    : 'Progress refreshes for up to one minute while this panel is open.'}{' '}
                  Cancellation prevents further stages; an in-flight provider request may finish before it
                  takes effect.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void operate(async () => showRun(await getCourseGeneration(getToken, run.id)))
                  }
                >
                  Refresh saved progress
                </button>
                {active ? (
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void operate(async () => {
                        showRun(await cancelCourseGeneration(getToken, run));
                        setNotice(
                          'Generation cancelled. Completed stages and budget allocations are retained.',
                        );
                        await refreshSaved();
                      })
                    }
                  >
                    Cancel generation
                  </button>
                ) : null}
                {!active ? (
                  <button
                    type="button"
                    className={button}
                    aria-expanded={sourceReviewRun === run.id}
                    onClick={() => setSourceReviewRun(sourceReviewRun === run.id ? '' : run.id)}
                  >
                    Review source changes and refresh
                  </button>
                ) : null}
              </div>
              {!active && sourceReviewRun === run.id ? (
                <>
                  <SourceImpactPanel key={run.id} getToken={getToken} run={run} />
                  <SelectiveRefreshPanel
                    key={`${run.id}:${run.revision}:${outline?.approval?.id ?? ''}:${hasUnsavedChanges}`}
                    getToken={getToken}
                    run={run}
                    outline={outline}
                    hasUnsavedChanges={hasUnsavedChanges}
                    onCreated={openRefresh}
                  />
                </>
              ) : null}
              {run.status === 'failed' || run.status === 'cancelled' ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p>
                    Completed stages will be reused. An uncertain attempt keeps its allocation. A new attempt
                    uses the remaining allowance; this run cannot exceed {run.policy.max_stage_attempts}{' '}
                    logical attempts per stage.
                  </p>
                  {retryable ? (
                    <>
                      <label className="mt-3 flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={retryAccepted}
                          disabled={busy}
                          onChange={(event) => setRetryAccepted(event.target.checked)}
                          className="mt-1"
                        />
                        I accept the remaining budget and want to resume this run.
                      </label>
                      <button
                        type="button"
                        className={`${button} mt-3`}
                        disabled={busy || !retryAccepted}
                        onClick={() =>
                          void operate(async () => {
                            if (!retryAccepted) return;
                            showRun(await resumeCourseGeneration(getToken, run));
                            setNotice('Generation resumed using saved stages and the retained budget.');
                            await refreshSaved();
                          })
                        }
                      >
                        Resume saved generation
                      </button>
                    </>
                  ) : (
                    <p className="mt-2 font-medium">
                      {unfinished.some((stage) => stage.error_code === 'policy_changed')
                        ? 'This run cannot resume under a changed generation policy.'
                        : 'This run has no remaining stage attempts.'}{' '}
                      Saved drafts remain available for review.
                    </p>
                  )}
                </div>
              ) : null}
              <ol key={run.id} className="space-y-3">
                {run.stages.map((stage, index) => {
                  const objective = run.plan.objectives.find((item) => item.id === stage.id);
                  return (
                    <li key={stage.id} className="min-w-0 rounded-lg border p-3">
                      <h5 className="break-words font-medium">
                        {index + 1}. {stage.title}
                      </h5>
                      {stage.reuse ? <p className="mt-1 text-sm">Reused from the original run.</p> : null}
                      <p className="mt-1 text-sm">
                        {stage.status.replaceAll('_', ' ')} · attempts {stage.attempts}/
                        {run.policy.max_stage_attempts}
                      </p>
                      {stage.error_code ? (
                        <p className="mt-2 text-sm font-medium text-amber-900">
                          {stage.error_code === 'operation_uncertain'
                            ? 'Provider outcome is uncertain. No automatic repeat will be charged.'
                            : stage.error_code === 'invalid_output'
                              ? 'The provider output did not pass lesson and evidence validation.'
                              : stage.error_code === 'policy_changed'
                                ? 'Generation policy changed. This saved run cannot silently switch policy.'
                                : 'This stage stopped before a validated lesson was saved.'}
                        </p>
                      ) : null}
                      {stage.output ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer font-medium">
                            Review saved lesson {index + 1}
                          </summary>
                          <h6 className="mt-3 break-words font-semibold">{stage.output.title}</h6>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                            {stage.output.explanation}
                          </p>
                          <p className="mt-3 text-sm font-semibold">Worked example</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                            {stage.output.worked_example}
                          </p>
                          <p className="mt-3 text-sm font-semibold">Check your understanding</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                            {stage.output.question}
                          </p>
                          <details className="mt-2 text-sm">
                            <summary className="cursor-pointer">Suggested answer — needs review</summary>
                            <p className="mt-1 whitespace-pre-wrap break-words">{stage.output.answer}</p>
                          </details>
                          <p className="mt-3 text-sm font-semibold">Approved evidence used</p>
                          {stage.output.evidence_ids.map((id) => {
                            const pin = objective?.evidence[Number(id.slice(4)) - 1];
                            return pin ? (
                              <blockquote
                                key={id}
                                className="mt-2 border-l-2 border-emerald-700 pl-3 text-sm"
                              >
                                <p className="break-words font-medium">
                                  {id} · {pinLocation(pin)}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap break-words">{pin.quote}</p>
                                <details className="mt-1">
                                  <summary className="cursor-pointer">Exact source version and hash</summary>
                                  <p className="mt-1 break-all">Version: {pin.version_id}</p>
                                  <p className="break-all">SHA-256: {pin.content_hash}</p>
                                </details>
                              </blockquote>
                            ) : null;
                          })}
                          {!active ? (
                            <GenerationLessonEditor
                              key={`${run.id}:${stage.id}`}
                              getToken={getToken}
                              run={run}
                              objectiveId={stage.id}
                              original={stage.output}
                              onSaved={async () => showRun(await getCourseGeneration(getToken, run.id))}
                            />
                          ) : null}
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
