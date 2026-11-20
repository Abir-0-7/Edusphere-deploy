'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChecklistCriterion, DraftChecklist } from '@studyvault/types';
import { DraftChecklistSchema } from '@studyvault/types';
import type { GetToken } from '@/lib/ai-client';
import {
  checklistNote,
  deleteChecklist,
  listChecklists,
  newChecklist,
  reviseChecklist,
  saveChecklist,
} from '@/lib/draft-checklist';
import { CourseNoteHandoff } from './course-note-handoff';

export function DraftChecklistWorkspace(props: { ownerId: string; getToken: GetToken }) {
  return <OwnedChecklist key={props.ownerId} {...props} />;
}
function OwnedChecklist({ ownerId, getToken }: { ownerId: string; getToken: GetToken }) {
  const [value, setValue] = useState(newChecklist);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [items, setItems] = useState<DraftChecklist[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const editVersion = useRef(0);
  const valid = DraftChecklistSchema.safeParse(value);
  useEffect(() => {
    mounted.current = true;
    void listChecklists(ownerId)
      .then((drafts) => {
        if (mounted.current) setItems(drafts);
      })
      .catch((cause: unknown) => {
        if (mounted.current)
          setError(cause instanceof Error ? cause.message : 'Could not open saved checklists.');
      });
    return () => {
      mounted.current = false;
    };
  }, [ownerId]);
  const change = (next: DraftChecklist) => {
    editVersion.current++;
    setValue(next);
    setMessage('Unsaved changes.');
    setError('');
  };
  function criterion(id: string, patch: Partial<ChecklistCriterion>) {
    change({
      ...value,
      criteria: value.criteria.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }
  async function save(copy = false) {
    if (busy) return;
    const version = editVersion.current;
    setBusy(true);
    setError('');
    try {
      const candidate = copy ? { ...value, id: crypto.randomUUID() } : value;
      const saved = await saveChecklist(ownerId, candidate, copy ? null : savedRevision);
      if (!mounted.current) return;
      if (editVersion.current === version) setValue(saved);
      setSavedRevision(saved.revision);
      const drafts = await listChecklists(ownerId);
      if (!mounted.current) return;
      setItems(drafts);
      setMessage(
        editVersion.current === version
          ? `Saved on this device. Revision ${saved.revision}.`
          : 'Earlier changes saved. Save again to include the latest edits.',
      );
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not save the checklist.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function removeSaved() {
    if (busy || savedRevision === null) return;
    setBusy(true);
    setError('');
    try {
      await deleteChecklist(ownerId, value.id, savedRevision);
      const drafts = await listChecklists(ownerId);
      if (!mounted.current) return;
      setItems(drafts);
      setSavedRevision(null);
      setValue({ ...value, id: crypto.randomUUID(), revision: 1 });
      setMessage('Saved copy removed. The current text remains open as an unsaved draft.');
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Could not remove the saved copy.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const field = 'mt-1 block w-full rounded border border-slate-500 p-2 text-sm';
  const button = 'rounded border border-blue-700 px-3 py-2 text-sm font-semibold disabled:opacity-50';
  return (
    <section
      id="draft-checklist"
      aria-label="Rubric draft checklist"
      className="min-w-0 space-y-3 rounded border p-4"
    >
      <h2 className="font-semibold">Rubric draft checklist</h2>
      <p className="text-sm">
        Review your draft against your assignment criteria. Confirm evidence yourself; this checklist does not
        grade your work.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-sm">
          Saved checklist
          <select
            className={field}
            value=""
            disabled={busy}
            onChange={(event) => {
              const selected = items.find((item) => item.id === event.target.value);
              if (selected) {
                editVersion.current++;
                setValue(selected);
                setSavedRevision(selected.revision);
                setMessage('Saved checklist opened.');
                setError('');
              }
            }}
          >
            <option value="">Choose a saved checklist</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} (revision {item.revision})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Checklist title
          <input
            className={field}
            value={value.title}
            maxLength={160}
            onChange={(event) => change({ ...value, title: event.target.value })}
          />
        </label>
        <label className="block text-sm">
          Your draft
          <textarea
            aria-label="Your draft"
            className={`${field} min-h-36`}
            value={value.draft}
            maxLength={10_000}
            onChange={(event) => change(reviseChecklist(value, event.target.value))}
          />
        </label>
        <p className="text-xs">Changing the draft clears confirmations whose exact excerpt is removed.</p>
        {value.criteria.map((item, index) => (
          <fieldset key={item.id} className="space-y-2 rounded border p-3">
            <legend>Criterion {index + 1}</legend>
            <label className="block text-sm">
              Criterion
              <input
                aria-label={`Criterion ${index + 1} label`}
                className={field}
                value={item.label}
                maxLength={240}
                onChange={(event) =>
                  criterion(item.id, { label: event.target.value, status: 'not-reviewed' })
                }
              />
            </label>
            <label className="block text-sm">
              Exact draft excerpt
              <textarea
                aria-label={`Criterion ${index + 1} evidence`}
                className={field}
                value={item.evidence}
                maxLength={1500}
                onChange={(event) =>
                  criterion(item.id, { evidence: event.target.value, status: 'not-reviewed' })
                }
              />
            </label>
            <label className="block text-sm">
              Review status
              <select
                aria-label={`Criterion ${index + 1} status`}
                className={field}
                value={item.status}
                onChange={(event) => {
                  const status = event.target.value;
                  if (
                    status === 'supported' &&
                    (!item.evidence.trim() || !value.draft.includes(item.evidence))
                  ) {
                    setError('Quote an exact excerpt from your current draft before marking it supported.');
                    return;
                  }
                  if (status === 'supported' || status === 'needs-work' || status === 'not-reviewed')
                    criterion(item.id, { status });
                }}
              >
                <option value="not-reviewed">Not reviewed</option>
                <option value="supported">Evidence present</option>
                <option value="needs-work">Needs work</option>
              </select>
            </label>
            <label className="block text-sm">
              Revision note
              <textarea
                aria-label={`Criterion ${index + 1} note`}
                className={field}
                value={item.note}
                maxLength={500}
                onChange={(event) => criterion(item.id, { note: event.target.value })}
              />
            </label>
            <button
              type="button"
              className={button}
              disabled={value.criteria.length === 1}
              onClick={() =>
                change({ ...value, criteria: value.criteria.filter((entry) => entry.id !== item.id) })
              }
            >
              Remove criterion {index + 1}
            </button>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            disabled={value.criteria.length >= 12}
            onClick={() =>
              change({
                ...value,
                criteria: [
                  ...value.criteria,
                  {
                    id: crypto.randomUUID(),
                    label: 'New criterion',
                    status: 'not-reviewed',
                    evidence: '',
                    note: '',
                  },
                ],
              })
            }
          >
            Add criterion
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !valid.success}
            onClick={() => {
              void save();
            }}
          >
            Save checklist
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !valid.success}
            onClick={() => {
              void save(true);
            }}
          >
            Save separate copy
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || savedRevision === null}
            onClick={() => {
              void removeSaved();
            }}
          >
            Remove saved copy
          </button>
          <button
            type="button"
            className={button}
            disabled={!valid.success}
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(valid.success ? valid.data : value, null, 2)], {
                  type: 'application/json',
                }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'draft-checklist.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download checklist
          </button>
        </div>
      </fieldset>
      {!valid.success && (
        <p className="text-sm">Enter a title and criteria. Evidence must match your draft exactly.</p>
      )}
      <p className="text-xs">
        Up to 12 checklists are stored under your account on this device. Download a copy to keep it
        elsewhere.
      </p>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      {valid.success && (
        <CourseNoteHandoff
          key={`${value.id}:${savedRevision ?? 'new'}`}
          ownerId={ownerId}
          getToken={getToken}
          text={checklistNote(valid.data)}
        />
      )}
    </section>
  );
}
