'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  EvidencePin,
  OutlineApproval,
  OutlineObjective,
  OutlinePlan,
  OutlineRecord,
  OutlineSourceSummary,
  OutlineSummary,
  SourceVersion,
} from '@studyvault/types';
import { AiHttpError, type GetToken } from '@/lib/ai-client';
import { listLibraryDocuments } from '@/lib/bibliography-client';
import { CourseGenerationPanel } from './course-generation-panel';
import { LocalSourceImport } from './local-source-import';
import {
  approveCourseOutline,
  getCourseOutline,
  getOutlineApprovals,
  getOutlineSource,
  listCourseOutlines,
  listOutlineSources,
  preparePdfOutlineSource,
  saveCourseOutline,
} from '@/lib/course-outline-client';

const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 py-2 text-slate-950';
const button =
  'rounded-lg border border-emerald-800 px-3 py-2 font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
const primary = `${button} bg-emerald-800 text-white hover:bg-emerald-900`;
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
const uniqueItems = <T extends { id: string }>(previous: T[], incoming: T[]) => [
  ...new Map([...previous, ...incoming].map((item) => [item.id, item])).values(),
];
const sourceSummary = (version: SourceVersion): OutlineSourceSummary => ({
  id: version.id,
  content_hash: version.content_hash,
  title: version.snapshot.title,
  kind: version.snapshot.origin.kind,
  segment_count: version.snapshot.segments.length,
  created_at: version.created_at,
});

function locatorLabel(locator: EvidencePin['locator']): string {
  if (locator.kind === 'pdf') {
    return `PDF position ${locator.pdf_page_index}${locator.printed_page_label ? `, printed ${locator.printed_page_label}` : ''}`;
  }
  if (locator.kind === 'text') return `Text lines ${locator.start_line}–${locator.end_line}`;
  const cell = locator.notebook_cell
    ? `, cell ${locator.notebook_cell.index} (${locator.notebook_cell.cell_type})`
    : '';
  return `${locator.path}${cell}, lines ${locator.start_line}–${locator.end_line}`;
}

function message(cause: unknown): string {
  if (cause instanceof Error && cause.name === 'ZodError') {
    return 'Outline validation failed. Check objective titles, source links, module assignments and prerequisite cycles.';
  }
  if (cause instanceof AiHttpError && cause.status === 409) {
    return `${cause.message} Your local edits are still here. Reload the saved revision explicitly to replace them.`;
  }
  return cause instanceof Error
    ? cause.message
    : 'The outline request failed. Your local edits are still here.';
}

export function CourseOutlinePlanner({ getToken, accountId }: { getToken: GetToken; accountId: string }) {
  if (!accountId) return null;
  return <OutlineWorkspace key={accountId} getToken={getToken} />;
}

function OutlineWorkspace({ getToken }: { getToken: GetToken }) {
  const [sources, setSources] = useState<OutlineSourceSummary[]>([]);
  const [sourceOffset, setSourceOffset] = useState(0);
  const [sourceTotal, setSourceTotal] = useState(0);
  const [sourceVersions, setSourceVersions] = useState<Record<string, SourceVersion>>({});
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [saved, setSaved] = useState<OutlineSummary[]>([]);
  const [savedOffset, setSavedOffset] = useState(0);
  const [savedTotal, setSavedTotal] = useState(0);
  const [savedChoice, setSavedChoice] = useState('');
  const [plan, setPlan] = useState<OutlinePlan | null>(null);
  const [record, setRecord] = useState<OutlineRecord | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftOutcome, setDraftOutcome] = useState('');
  const [draftObjectives, setDraftObjectives] = useState('');
  const [newObjective, setNewObjective] = useState('');
  const [newModule, setNewModule] = useState('');
  const [moduleObjective, setModuleObjective] = useState('');
  const [history, setHistory] = useState<OutlineApproval[] | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [working, setWorking] = useState(false);
  const [initialLoad, setInitialLoad] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [documents, setDocuments] = useState<{ id: string; title: string }[]>([]);
  const [documentChoice, setDocumentChoice] = useState('');
  const draftId = useRef<string | null>(null);
  const dirty = plan !== null && (record === null || JSON.stringify(plan) !== JSON.stringify(record.plan));
  const selected = plan ? plan.sources.map((source) => source.version_id) : selectedSources;
  const loading = initialLoad === 'loading';

  useEffect(() => {
    let active = true;
    void Promise.all([listOutlineSources(getToken), listCourseOutlines(getToken)])
      .then(([available, outlines]) => {
        if (!active) return;
        setSources(available.items);
        setSourceOffset(available.items.length);
        setSourceTotal(available.total_count);
        setSaved(outlines.items);
        setSavedOffset(outlines.items.length);
        setSavedTotal(outlines.total_count);
        setInitialLoad('ready');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof AiHttpError && cause.status === 404) setInitialLoad('unavailable');
        else {
          setError(message(cause));
          setInitialLoad('error');
        }
      });
    return () => {
      active = false;
    };
  }, [getToken, loadAttempt]);

  function edit(change: (next: OutlinePlan) => void) {
    setPlan((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      change(next);
      return next;
    });
    setReviewed(false);
    setNotice('');
  }

  function changeObjective(id: string, patch: Partial<OutlineObjective>, resetReview = true) {
    edit((next) => {
      const objective = next.objectives.find((item) => item.id === id);
      if (objective) Object.assign(objective, patch, resetReview ? { review_status: 'needs_review' } : {});
    });
  }

  async function operate(action: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (cause: unknown) {
      setError(message(cause));
    } finally {
      setWorking(false);
    }
  }

  async function chooseSource(id: string, checked: boolean) {
    setError(null);
    if (plan) {
      const summary = sources.find((item) => item.id === id);
      if (!summary) return;
      edit((next) => {
        if (checked && !next.sources.some((item) => item.version_id === id))
          next.sources.push({ version_id: id, content_hash: summary.content_hash });
        else {
          next.sources = next.sources.filter((item) => item.version_id !== id);
          next.objectives.forEach((objective) => {
            if (objective.evidence.some((pin) => pin.version_id === id)) {
              objective.evidence = objective.evidence.filter((pin) => pin.version_id !== id);
              objective.review_status = 'needs_review';
            }
          });
          next.conflicts = next.conflicts.filter(
            (conflict) => conflict.first.version_id !== id && conflict.second.version_id !== id,
          );
        }
      });
    } else
      setSelectedSources((current) =>
        checked ? [...new Set([...current, id])] : current.filter((item) => item !== id),
      );
    if (checked && !sourceVersions[id]) {
      try {
        const version = await getOutlineSource(getToken, id);
        setSourceVersions((current) => ({ ...current, [id]: version }));
      } catch (cause: unknown) {
        setError(message(cause));
      }
    }
  }

  function makeDraft() {
    const titles = draftObjectives
      .split('\n')
      .map((text) => text.trim())
      .filter(Boolean);
    if (
      !draftTitle.trim() ||
      !draftOutcome.trim() ||
      !titles.length ||
      titles.length > 30 ||
      !selectedSources.length
    ) {
      setError('Choose sources, a title, an outcome and 1–30 objective titles.');
      return;
    }
    const objectives: OutlineObjective[] = titles.map((title) => ({
      id: newId('objective'),
      title,
      estimated_minutes: 30,
      prerequisite_ids: [],
      evidence: [],
      review_status: 'needs_review',
    }));
    setPlan({
      schema_version: 1,
      title: draftTitle.trim(),
      outcome: draftOutcome.trim(),
      sources: sources
        .filter((item) => selectedSources.includes(item.id))
        .map((item) => ({ version_id: item.id, content_hash: item.content_hash })),
      objectives,
      modules: [
        { id: newId('module'), title: 'Core learning', objective_ids: objectives.map((item) => item.id) },
      ],
      conflicts: [],
    });
    draftId.current = crypto.randomUUID();
    setRecord(null);
    setHistory(null);
    setReviewed(false);
    setError(null);
    setNotice('Draft created locally. Link and review evidence, then save to check coverage.');
  }

  async function acceptRecord(next: OutlineRecord) {
    setRecord(next);
    setPlan(structuredClone(next.plan));
    setReviewed(false);
    setHistory(null);
    draftId.current = next.id;
    const versions = await Promise.all(
      next.plan.sources.map((source) => getOutlineSource(getToken, source.version_id)),
    );
    setSourceVersions((current) => ({
      ...current,
      ...Object.fromEntries(versions.map((version) => [version.id, version])),
    }));
    setSources((current) => uniqueItems(current, versions.map(sourceSummary)));
  }

  async function refreshSaved() {
    const outlines = await listCourseOutlines(getToken);
    setSaved(outlines.items);
    setSavedOffset(outlines.items.length);
    setSavedTotal(outlines.total_count);
  }

  async function save() {
    if (!plan || !draftId.current) return;
    await operate(async () => {
      const next = await saveCourseOutline(getToken, draftId.current!, plan, record?.revision);
      setRecord(next);
      setPlan(structuredClone(next.plan));
      setReviewed(false);
      setHistory(null);
      setNotice(`Revision ${next.revision} saved. Coverage checked by the server.`);
      await refreshSaved();
    });
  }

  function removeObjective(id: string) {
    edit((next) => {
      next.objectives = next.objectives.filter((item) => item.id !== id);
      next.objectives.forEach((item) => {
        item.prerequisite_ids = item.prerequisite_ids.filter((parent) => parent !== id);
      });
      next.modules = next.modules
        .map((item) => ({ ...item, objective_ids: item.objective_ids.filter((value) => value !== id) }))
        .filter((item) => item.objective_ids.length > 0);
      next.conflicts = next.conflicts.filter((item) => item.objective_id !== id);
    });
  }

  function reorderObjective(id: string, direction: number) {
    edit((next) => {
      const module = next.modules.find((item) => item.objective_ids.includes(id));
      if (!module) return;
      const index = module.objective_ids.indexOf(id),
        target = index + direction;
      if (target < 0 || target >= module.objective_ids.length) return;
      const from = module.objective_ids[index],
        to = module.objective_ids[target];
      if (from && to) {
        module.objective_ids[index] = to;
        module.objective_ids[target] = from;
      }
    });
  }

  const orderedIds = plan
    ? [
        ...plan.modules.flatMap((module) => module.objective_ids),
        ...plan.objectives
          .filter((objective) => !plan.modules.some((module) => module.objective_ids.includes(objective.id)))
          .map((objective) => objective.id),
      ]
    : [];

  if (initialLoad !== 'ready')
    return (
      <section
        aria-labelledby="outline-planner-heading"
        className="mt-10 min-w-0 rounded-2xl border border-slate-300 bg-slate-50 p-4 text-slate-950 sm:p-6"
      >
        <h2 id="outline-planner-heading" className="text-2xl font-bold">
          Plan a private course
        </h2>
        {initialLoad === 'error' ? (
          <>
            <p
              role="alert"
              className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-red-300 bg-red-50 p-3 text-red-900"
            >
              {error}
            </p>
            <button
              type="button"
              className={`${button} mt-3`}
              onClick={() => {
                setError(null);
                setInitialLoad('loading');
                setLoadAttempt((current) => current + 1);
              }}
            >
              Retry loading private outlines
            </button>
          </>
        ) : (
          <p role="status" aria-live="polite" className="mt-3 text-sm text-slate-700">
            {loading
              ? 'Loading private sources and outlines.'
              : 'Private course planning is not available in this environment yet. You can continue browsing the course catalog.'}
          </p>
        )}
      </section>
    );

  return (
    <section
      aria-labelledby="outline-planner-heading"
      className="mt-10 min-w-0 rounded-2xl border border-slate-300 bg-slate-50 p-4 text-slate-950 sm:p-6"
    >
      <h2 id="outline-planner-heading" className="text-2xl font-bold">
        Plan a private course
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
        Write an outline, link precise source evidence and review missing support before approving it. Linked
        quotes verify source locations; they do not automatically prove that a claim is correct. Owner
        approval is private. Editorial review is not completed and nothing is published to the catalog.
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-red-300 bg-red-50 p-3 text-red-900"
        >
          {error}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="mt-3 text-sm text-emerald-900">
        {loading ? 'Loading private sources and outlines…' : notice}
      </p>
      <fieldset disabled={working || loading} className="mt-4 min-w-0 space-y-3">
        <legend className="font-semibold">Saved outlines</legend>
        <label className="block text-sm">
          Outline to open
          <select
            className={field}
            value={savedChoice}
            onChange={(event) => setSavedChoice(event.target.value)}
          >
            <option value="">Choose a saved outline</option>
            {saved.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} — revision {item.revision}, {item.status}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={button}
          disabled={!savedChoice}
          onClick={() =>
            void operate(async () => {
              await acceptRecord(await getCourseOutline(getToken, savedChoice));
              setNotice('Saved outline loaded.');
            })
          }
        >
          Open saved outline{dirty ? ' (replace local edits)' : ''}
        </button>
        {savedOffset < savedTotal ? (
          <button
            type="button"
            className={button}
            onClick={() =>
              void operate(async () => {
                const page = await listCourseOutlines(getToken, savedOffset);
                setSaved((current) => uniqueItems(current, page.items));
                setSavedTotal(page.total_count);
                setSavedOffset(page.items.length ? savedOffset + page.items.length : page.total_count);
              })
            }
          >
            Load more saved outlines
          </button>
        ) : null}
      </fieldset>

      <fieldset disabled={working || loading} className="mt-6 min-w-0 space-y-3">
        <legend className="font-semibold">Pinned source versions</legend>
        <p className="text-sm text-slate-700">
          Select up to eight prepared sources. Removing a source also removes its linked quotes and conflict
          flags from this draft.
        </p>
        <div className="grid min-w-0 gap-2 md:grid-cols-2">
          {sources.map((source) => (
            <label
              key={source.id}
              className="flex min-w-0 items-start gap-2 rounded-lg border bg-white p-3 text-sm"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.includes(source.id)}
                disabled={!selected.includes(source.id) && selected.length >= 8}
                onChange={(event) => void chooseSource(source.id, event.target.checked)}
              />
              <span className="min-w-0 break-words">
                {source.title}
                <span className="mt-1 block text-xs text-slate-600">
                  {source.kind} · {source.segment_count} evidence segments ·{' '}
                  {source.content_hash.slice(0, 10)}
                </span>
              </span>
            </label>
          ))}
        </div>
        {sourceOffset < sourceTotal ? (
          <button
            type="button"
            className={button}
            onClick={() =>
              void operate(async () => {
                const page = await listOutlineSources(getToken, sourceOffset);
                setSources((current) => uniqueItems(current, page.items));
                setSourceTotal(page.total_count);
                setSourceOffset(page.items.length ? sourceOffset + page.items.length : page.total_count);
              })
            }
          >
            Load more sources
          </button>
        ) : null}
        {!sources.length && !loading ? <p>No prepared versions yet. Add a source below.</p> : null}
        <details className="rounded-lg border bg-white p-3">
          <summary className="cursor-pointer font-medium">
            Prepare a source version from my PDF library
          </summary>
          <p className="mt-2 text-sm">
            Only parsed PDFs with precise page evidence can be prepared. Other library items show a clear
            error.
          </p>
          <button
            type="button"
            className={`${button} mt-2`}
            onClick={() =>
              void operate(async () => {
                setDocuments(await listLibraryDocuments(getToken));
              })
            }
          >
            Load library documents
          </button>
          <label className="mt-2 block text-sm">
            PDF document
            <select
              className={field}
              value={documentChoice}
              onChange={(event) => setDocumentChoice(event.target.value)}
            >
              <option value="">Choose a library document</option>
              {documents.map((document) => (
                <option value={document.id} key={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`${button} mt-2`}
            disabled={!documentChoice}
            onClick={() =>
              void operate(async () => {
                const version = await preparePdfOutlineSource(getToken, documentChoice);
                const available = await listOutlineSources(getToken);
                setSources((current) => uniqueItems(current, available.items));
                setSourceOffset(available.items.length);
                setSourceTotal(available.total_count);
                setSourceVersions((current) => ({ ...current, [version.id]: version }));
                setNotice('PDF source version prepared. Select it above.');
              })
            }
          >
            Prepare PDF version
          </button>
        </details>
        <LocalSourceImport
          getToken={getToken}
          onImported={(version) => {
            setSourceVersions((current) => ({ ...current, [version.id]: version }));
            setSources((current) => uniqueItems(current, [sourceSummary(version)]));
            setNotice('Source version prepared. Select it above.');
            void listOutlineSources(getToken)
              .then((available) => {
                setSources((current) => uniqueItems(current, available.items));
                setSourceOffset(available.items.length);
                setSourceTotal(available.total_count);
              })
              .catch((cause: unknown) => setError(message(cause)));
          }}
        />
      </fieldset>

      {!plan ? (
        <fieldset disabled={working || loading} className="mt-6 min-w-0 space-y-3">
          <legend className="font-semibold">Draft your learning outline</legend>
          <label className="block text-sm">
            Course title
            <input
              className={field}
              maxLength={200}
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Learning outcome
            <textarea
              className={field}
              rows={2}
              maxLength={2000}
              value={draftOutcome}
              onChange={(event) => setDraftOutcome(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Objectives, one per line
            <textarea
              className={field}
              rows={4}
              value={draftObjectives}
              onChange={(event) => setDraftObjectives(event.target.value)}
            />
          </label>
          <p className="text-sm text-slate-700">
            This creates your authored plan. It does not generate lessons or claim that sources support it.
          </p>
          <button type="button" className={primary} onClick={makeDraft}>
            Create local outline
          </button>
        </fieldset>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full border bg-white px-3 py-1">Private</span>
            <span className="rounded-full border bg-white px-3 py-1">Editorial: not reviewed</span>
            <span className="rounded-full border bg-white px-3 py-1">
              {dirty
                ? 'Unsaved changes — approval does not cover this draft'
                : record?.status === 'approved'
                  ? `Owner approved revision ${record.revision}`
                  : `Draft revision ${record?.revision ?? 'not saved'}`}
            </span>
          </div>
          <fieldset disabled={working} className="mt-4 min-w-0 space-y-3">
            <legend className="font-semibold">Outline details</legend>
            <label className="block text-sm">
              Outline title
              <input
                className={field}
                maxLength={200}
                value={plan.title}
                onChange={(event) =>
                  edit((next) => {
                    next.title = event.target.value;
                  })
                }
              />
            </label>
            <label className="block text-sm">
              Outline outcome
              <textarea
                className={field}
                rows={2}
                maxLength={2000}
                value={plan.outcome}
                onChange={(event) =>
                  edit((next) => {
                    next.outcome = event.target.value;
                  })
                }
              />
            </label>
            <div className="space-y-3">
              {plan.modules.map((module, index) => (
                <div key={module.id} className="rounded-lg border bg-white p-3">
                  <label className="block text-sm">
                    Module {index + 1} title
                    <input
                      className={field}
                      value={module.title}
                      maxLength={200}
                      onChange={(event) =>
                        edit((next) => {
                          const current = next.modules.find((item) => item.id === module.id);
                          if (current) current.title = event.target.value;
                        })
                      }
                    />
                  </label>
                  <ol className="my-2 list-inside list-decimal text-sm">
                    {module.objective_ids.map((id) => (
                      <li key={id} className="break-words">
                        {plan.objectives.find((item) => item.id === id)?.title}
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    {[-1, 1].map((direction) => (
                      <button
                        key={direction}
                        type="button"
                        className={button}
                        disabled={index + direction < 0 || index + direction >= plan.modules.length}
                        onClick={() =>
                          edit((next) => {
                            const from = next.modules[index],
                              to = next.modules[index + direction];
                            if (from && to) {
                              next.modules[index] = to;
                              next.modules[index + direction] = from;
                            }
                          })
                        }
                      >
                        Move module {index + 1} {direction < 0 ? 'up' : 'down'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm">
                New module title
                <input
                  className={field}
                  value={newModule}
                  maxLength={200}
                  onChange={(event) => setNewModule(event.target.value)}
                />
              </label>
              <label className="text-sm">
                Move objective into new module
                <select
                  className={field}
                  value={moduleObjective}
                  onChange={(event) => setModuleObjective(event.target.value)}
                >
                  <option value="">Choose objective</option>
                  {plan.objectives.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className={button}
              disabled={!newModule.trim() || !moduleObjective || plan.modules.length >= 12}
              onClick={() => {
                edit((next) => {
                  next.modules = next.modules
                    .map((item) => ({
                      ...item,
                      objective_ids: item.objective_ids.filter((id) => id !== moduleObjective),
                    }))
                    .filter((item) => item.objective_ids.length);
                  next.modules.push({
                    id: newId('module'),
                    title: newModule.trim(),
                    objective_ids: [moduleObjective],
                  });
                });
                setNewModule('');
                setModuleObjective('');
              }}
            >
              Add module
            </button>
          </fieldset>

          <div className="mt-6 space-y-4">
            {orderedIds.map((id, index) => {
              const objective = plan.objectives.find((item) => item.id === id);
              if (!objective) return null;
              const coverage = record?.coverage.objectives.find((item) => item.objective_id === id);
              return (
                <fieldset
                  disabled={working}
                  key={id}
                  className="min-w-0 rounded-xl border border-slate-300 bg-white p-4"
                >
                  <legend className="px-1 font-semibold">
                    Objective {index + 1}: {objective.title || 'Untitled objective'}
                  </legend>
                  <label className="block text-sm">
                    Objective {index + 1} title
                    <input
                      className={field}
                      maxLength={200}
                      value={objective.title}
                      onChange={(event) => changeObjective(id, { title: event.target.value })}
                    />
                  </label>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Estimated minutes for objective {index + 1}
                      <input
                        type="number"
                        min={1}
                        max={600}
                        className={field}
                        value={objective.estimated_minutes}
                        onChange={(event) =>
                          changeObjective(id, { estimated_minutes: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="text-sm">
                      Module for objective {index + 1}
                      <select
                        className={field}
                        value={plan.modules.find((item) => item.objective_ids.includes(id))?.id ?? ''}
                        onChange={(event) =>
                          edit((next) => {
                            const target = event.target.value;
                            next.modules.forEach((item) => {
                              item.objective_ids = item.objective_ids.filter((value) => value !== id);
                            });
                            next.modules.find((item) => item.id === target)?.objective_ids.push(id);
                            next.modules = next.modules.filter((item) => item.objective_ids.length > 0);
                          })
                        }
                      >
                        <option value="">Unassigned</option>
                        {plan.modules.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={button} onClick={() => reorderObjective(id, -1)}>
                      Move objective {index + 1} up
                    </button>
                    <button type="button" className={button} onClick={() => reorderObjective(id, 1)}>
                      Move objective {index + 1} down
                    </button>
                    <button
                      type="button"
                      className={button}
                      disabled={plan.objectives.length <= 1}
                      onClick={() => removeObjective(id)}
                    >
                      Remove objective {index + 1}
                    </button>
                  </div>
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer font-medium">
                      Prerequisites for objective {index + 1}
                    </summary>
                    {plan.objectives
                      .filter((item) => item.id !== id)
                      .map((item) => (
                        <label key={item.id} className="mt-2 flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={objective.prerequisite_ids.includes(item.id)}
                            onChange={(event) =>
                              changeObjective(id, {
                                prerequisite_ids: event.target.checked
                                  ? [...objective.prerequisite_ids, item.id]
                                  : objective.prerequisite_ids.filter((value) => value !== item.id),
                              })
                            }
                          />
                          {item.title}
                        </label>
                      ))}
                  </details>
                  <p className="mt-3 text-sm font-medium">
                    {dirty ? 'Coverage pending save' : `Saved coverage: ${coverage?.status ?? 'not checked'}`}{' '}
                    · {objective.evidence.length} linked quotes
                  </p>
                  {record?.coverage.misordered_objective_ids.includes(id) ? (
                    <p className="mt-2 text-sm font-medium text-amber-900">
                      Saved prerequisite order: a prerequisite is taught later. Reorder the modules/objectives
                      and save to check again.
                    </p>
                  ) : null}
                  <div className="mt-2 space-y-2">
                    {objective.evidence.map((pin, pinIndex) => (
                      <div
                        key={`${pin.version_id}:${pin.segment_id}:${pinIndex}`}
                        className="min-w-0 rounded-lg border bg-slate-50 p-3 text-sm"
                      >
                        <p className="break-words font-medium">
                          {sources.find((item) => item.id === pin.version_id)?.title ??
                            sourceVersions[pin.version_id]?.snapshot.title ??
                            'Pinned source'}{' '}
                          — {locatorLabel(pin.locator)}
                        </p>
                        <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-emerald-700 pl-3">
                          {pin.quote}
                        </blockquote>
                        <button
                          type="button"
                          className={`${button} mt-2`}
                          onClick={() =>
                            edit((next) => {
                              const current = next.objectives.find((item) => item.id === id)!;
                              current.evidence.splice(pinIndex, 1);
                              current.review_status = 'needs_review';
                              next.conflicts = next.conflicts.filter(
                                (conflict) => conflict.objective_id !== id,
                              );
                            })
                          }
                        >
                          Remove quote {pinIndex + 1} from objective {index + 1}
                        </button>
                      </div>
                    ))}
                  </div>
                  <EvidencePicker
                    versions={plan.sources
                      .map((source) => sourceVersions[source.version_id])
                      .filter((item): item is SourceVersion => Boolean(item))}
                    objectiveNumber={index + 1}
                    disabled={working || objective.evidence.length >= 4}
                    onAdd={(pin) => {
                      if (objective.evidence.some((item) => JSON.stringify(item) === JSON.stringify(pin))) {
                        setError('This exact quote is already linked.');
                        return;
                      }
                      changeObjective(id, { evidence: [...objective.evidence, pin] });
                    }}
                  />
                  <label className="mt-3 flex items-start gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={objective.review_status === 'reviewed'}
                      onChange={(event) =>
                        changeObjective(
                          id,
                          { review_status: event.target.checked ? 'reviewed' : 'needs_review' },
                          false,
                        )
                      }
                    />
                    I reviewed the evidence for objective {index + 1}
                  </label>
                  {objective.evidence.length >= 2 ? (
                    <ConflictCreator
                      objective={objective}
                      number={index + 1}
                      onCreate={(description, first, second) =>
                        edit((next) => {
                          if (next.conflicts.length < 20)
                            next.conflicts.push({
                              id: newId('conflict'),
                              objective_id: id,
                              first,
                              second,
                              description,
                              resolution: null,
                            });
                        })
                      }
                    />
                  ) : null}
                </fieldset>
              );
            })}
          </div>

          <fieldset disabled={working} className="mt-4 min-w-0">
            <legend className="font-semibold">Add another objective</legend>
            <label className="block text-sm">
              New objective title
              <input
                className={field}
                value={newObjective}
                maxLength={200}
                onChange={(event) => setNewObjective(event.target.value)}
              />
            </label>
            <button
              type="button"
              className={`${button} mt-2`}
              disabled={!newObjective.trim() || plan.objectives.length >= 30}
              onClick={() => {
                edit((next) => {
                  const id = newId('objective');
                  next.objectives.push({
                    id,
                    title: newObjective.trim(),
                    estimated_minutes: 30,
                    prerequisite_ids: [],
                    evidence: [],
                    review_status: 'needs_review',
                  });
                  if (next.modules[0]) next.modules[0].objective_ids.push(id);
                  else
                    next.modules.push({ id: newId('module'), title: 'Core learning', objective_ids: [id] });
                });
                setNewObjective('');
              }}
            >
              Add objective
            </button>
          </fieldset>

          {plan.conflicts.length ? (
            <fieldset disabled={working} className="mt-6 min-w-0 space-y-3">
              <legend className="font-semibold">Source conflicts flagged for review</legend>
              {plan.conflicts.map((conflict, index) => (
                <div key={conflict.id} className="rounded-lg border border-amber-400 bg-amber-50 p-3">
                  <p className="whitespace-pre-wrap break-words text-sm">{conflict.description}</p>
                  <p className="mt-1 text-xs">
                    Two linked source quotes ·{' '}
                    {conflict.resolution ? 'Resolution recorded' : 'Unresolved — blocks approval'}
                  </p>
                  <label className="mt-2 block text-sm">
                    Resolution for conflict {index + 1}
                    <textarea
                      className={field}
                      rows={2}
                      maxLength={1000}
                      value={conflict.resolution ?? ''}
                      onChange={(event) =>
                        edit((next) => {
                          const current = next.conflicts.find((item) => item.id === conflict.id);
                          if (current) current.resolution = event.target.value || null;
                        })
                      }
                    />
                  </label>
                </div>
              ))}
            </fieldset>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className={primary}
              disabled={working || !dirty}
              onClick={() => void save()}
            >
              Save outline and check coverage
            </button>
            {record ? (
              <button
                type="button"
                className={button}
                disabled={working}
                onClick={() =>
                  void operate(async () => {
                    await acceptRecord(await getCourseOutline(getToken, record.id));
                    setNotice('Saved revision reloaded. Local changes replaced.');
                  })
                }
              >
                Reload saved revision{dirty ? ' (discard local changes)' : ''}
              </button>
            ) : null}
            <button
              type="button"
              className={button}
              disabled={working}
              onClick={() => {
                setPlan(null);
                setRecord(null);
                setReviewed(false);
                setHistory(null);
                draftId.current = null;
                setNotice('');
                setError(null);
              }}
            >
              Start new outline{dirty ? ' (discard local changes)' : ''}
            </button>
          </div>

          {record ? (
            <section aria-label="Saved coverage report" className="mt-6 rounded-xl border bg-white p-4">
              <h3 className="text-lg font-semibold">Saved coverage report — revision {record.revision}</h3>
              {dirty ? (
                <p className="mt-2 font-semibold text-amber-900">
                  This report is for the saved revision. Save local edits to refresh it.
                </p>
              ) : null}
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ['Missing support', record.coverage.gap_objective_ids.length],
                  ['Multi-source overlap', record.coverage.overlap_objective_ids.length],
                  ['Needs owner review', record.coverage.unreviewed_objective_ids.length],
                  ['Unresolved conflicts', record.coverage.unresolved_conflict_ids.length],
                  ['Unassigned objectives', record.coverage.unmapped_objective_ids.length],
                  ['Prerequisites taught later', record.coverage.misordered_objective_ids.length],
                  ['Unused sources', record.coverage.unused_source_version_ids.length],
                  ['Estimated minutes', record.coverage.estimated_minutes],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-slate-600">{label}</dt>
                    <dd className="mt-1 text-xl font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-sm">
                Effort is the sum of your objective estimates, not a measured completion-time promise. Overlap
                means linked evidence from multiple sources, not automatic agreement or contradiction.
              </p>
              <label className="mt-4 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={dirty || working || !record.coverage.ready_for_approval}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                I reviewed this exact saved outline, its sources and conflict resolutions.
              </label>
              <button
                type="button"
                className={`${primary} mt-3`}
                disabled={
                  working ||
                  dirty ||
                  !reviewed ||
                  !record.coverage.ready_for_approval ||
                  record.status === 'approved'
                }
                onClick={() =>
                  void operate(async () => {
                    const approved = await approveCourseOutline(getToken, record);
                    setRecord(approved);
                    setPlan(structuredClone(approved.plan));
                    setReviewed(false);
                    setNotice(
                      `Owner approved revision ${approved.revision}. Editorial review is still not completed.`,
                    );
                    await refreshSaved();
                  })
                }
              >
                Approve saved outline
              </button>
              <p className="mt-2 text-sm">
                Approval requires linked evidence for every objective, all owner reviews, module assignments
                and resolved conflict flags. It does not publish or generate a course.
              </p>
              <button
                type="button"
                className={`${button} mt-3`}
                disabled={working}
                onClick={() =>
                  void operate(async () => {
                    setHistory((await getOutlineApprovals(getToken, record.id)).items);
                  })
                }
              >
                View approval history
              </button>
              {history ? (
                <div className="mt-3" role="region" aria-label="Immutable outline approvals">
                  {!history.length ? (
                    <p>No owner approvals yet.</p>
                  ) : (
                    history.map((approval) => (
                      <details key={approval.id} className="mt-2 rounded-lg border p-3">
                        <summary className="cursor-pointer font-medium">
                          Approved revision {approval.revision} — {approval.snapshot.plan.title}
                        </summary>
                        <p className="mt-2 text-sm">
                          {approval.created_at} · {approval.snapshot.coverage.estimated_minutes} estimated
                          minutes · private / editorial not reviewed
                        </p>
                        <ol className="mt-2 list-inside list-decimal text-sm">
                          {approval.snapshot.plan.modules.map((module) => (
                            <li key={module.id}>{module.title}</li>
                          ))}
                        </ol>
                      </details>
                    ))
                  )}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
      <CourseGenerationPanel getToken={getToken} outline={record} hasUnsavedChanges={dirty} />
    </section>
  );
}

function EvidencePicker({
  versions,
  objectiveNumber,
  onAdd,
  disabled,
}: {
  versions: SourceVersion[];
  objectiveNumber: number;
  onAdd: (pin: EvidencePin) => void;
  disabled: boolean;
}) {
  const [sourceId, setSourceId] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [quote, setQuote] = useState('');
  const version = versions.find((item) => item.id === sourceId);
  const segment = version?.snapshot.segments.find((item) => item.id === segmentId);
  const exact = Boolean(segment && quote.trim() && quote.length <= 4000 && segment.text.includes(quote));
  return (
    <details className="mt-3 min-w-0 rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Link evidence to objective {objectiveNumber}
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Source for objective {objectiveNumber}
          <select
            className={field}
            value={version ? sourceId : ''}
            disabled={disabled}
            onChange={(event) => {
              setSourceId(event.target.value);
              setSegmentId('');
              setQuote('');
            }}
          >
            <option value="">Choose source</option>
            {versions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.snapshot.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Segment for objective {objectiveNumber}
          <select
            className={field}
            value={segment ? segmentId : ''}
            disabled={disabled || !version}
            onChange={(event) => {
              const next = version?.snapshot.segments.find((item) => item.id === event.target.value);
              setSegmentId(event.target.value);
              setQuote(next?.text.slice(0, 4000) ?? '');
            }}
          >
            <option value="">Choose source segment</option>
            {version?.snapshot.segments.map((item, index) => (
              <option key={item.id} value={item.id}>
                {index + 1}. {locatorLabel(item.locator)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {segment ? (
        <>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer">Read complete saved segment</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-sans">
              {segment.text}
            </pre>
          </details>
          <label className="mt-2 block text-sm">
            Exact quote for objective {objectiveNumber}
            <textarea
              className={field}
              rows={3}
              value={quote}
              maxLength={4000}
              disabled={disabled}
              onChange={(event) => setQuote(event.target.value)}
            />
          </label>
          {!exact ? (
            <p className="mt-1 text-sm text-amber-900">
              The quote must be an exact, nonempty excerpt of this saved segment.
            </p>
          ) : null}
        </>
      ) : null}
      <button
        type="button"
        className={`${button} mt-2`}
        disabled={disabled || !exact}
        onClick={() => {
          if (version && segment && exact)
            onAdd({
              version_id: version.id,
              content_hash: version.content_hash,
              segment_id: segment.id,
              locator: segment.locator,
              quote,
            });
        }}
      >
        Attach quote to objective {objectiveNumber}
      </button>
    </details>
  );
}

function ConflictCreator({
  objective,
  number,
  onCreate,
}: {
  objective: OutlineObjective;
  number: number;
  onCreate: (description: string, first: EvidencePin, second: EvidencePin) => void;
}) {
  const [description, setDescription] = useState('');
  const [first, setFirst] = useState(0),
    [second, setSecond] = useState(1);
  return (
    <details className="mt-3 rounded-lg border border-amber-300 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Flag a source conflict for objective {number}
      </summary>
      <p className="mt-2 text-sm">
        Describe a concern you found. Different excerpts alone are not evidence of a contradiction.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {(['First', 'Second'] as const).map((label) => (
          <label key={label} className="text-sm">
            {label} conflict quote for objective {number}
            <select
              className={field}
              value={label === 'First' ? first : second}
              onChange={(event) =>
                label === 'First'
                  ? setFirst(Number(event.target.value))
                  : setSecond(Number(event.target.value))
              }
            >
              {objective.evidence.map((pin, index) => (
                <option key={index} value={index}>
                  Quote {index + 1}: {pin.quote.slice(0, 70)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label className="mt-2 block text-sm">
        Conflict description for objective {number}
        <textarea
          className={field}
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <button
        type="button"
        className={`${button} mt-2`}
        disabled={
          !description.trim() || first === second || !objective.evidence[first] || !objective.evidence[second]
        }
        onClick={() => {
          const one = objective.evidence[first],
            two = objective.evidence[second];
          if (one && two) {
            onCreate(description.trim(), one, two);
            setDescription('');
          }
        }}
      >
        Add conflict flag for objective {number}
      </button>
    </details>
  );
}
