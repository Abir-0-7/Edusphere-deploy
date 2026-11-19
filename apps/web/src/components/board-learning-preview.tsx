'use client';

import { useEffect, useRef, useState } from 'react';
import type { ConceptGraphNodeActions } from '@studyvault/types';
import { z } from 'zod';
import { getConceptGraphNodeActions, type GetToken } from '@/lib/ai-client';

export const BoardGraphHandoffSchema = z.strictObject({
  documentId: z.uuid(),
  nodeId: z.string().trim().min(1).max(120),
  revision: z.coerce.number().int().positive(),
});

export type BoardGraphHandoff = z.infer<typeof BoardGraphHandoffSchema>;
type BoardTarget = NonNullable<ConceptGraphNodeActions['board']>;

export function readBoardGraphHandoff(search: Pick<URLSearchParams, 'get'>): BoardGraphHandoff | null {
  const parsed = BoardGraphHandoffSchema.safeParse({
    documentId: search.get('source_document'),
    nodeId: search.get('graph_node'),
    revision: search.get('graph_revision'),
  });
  return parsed.success ? parsed.data : null;
}

export function BoardLearningPreview({
  ownerId,
  getToken,
  onInsert,
  handoff: suppliedHandoff,
}: {
  ownerId: string;
  getToken: GetToken;
  onInsert: (board: BoardTarget, revision: number) => void;
  handoff?: BoardGraphHandoff | null;
}) {
  const [handoff, setHandoff] = useState<BoardGraphHandoff | null>(suppliedHandoff ?? null);
  const [target, setTarget] = useState<BoardTarget | null>(null);
  const [targetOwnerId, setTargetOwnerId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const accountGeneration = useRef(0);
  const activeOwner = useRef(ownerId);
  activeOwner.current = ownerId;

  useEffect(() => {
    accountGeneration.current += 1;
    setBusy(false);
    setInserted(false);
    setDismissed(false);
    return () => { accountGeneration.current += 1; };
  }, [handoff, ownerId]);

  useEffect(() => {
    setHandoff(suppliedHandoff === undefined
      ? readBoardGraphHandoff(new URLSearchParams(window.location.search))
      : suppliedHandoff);
  }, [suppliedHandoff]);

  useEffect(() => {
    let active = true;
    setTarget(null);
    setTargetOwnerId(null);
    setError('');
    if (!handoff) return () => { active = false; };
    setMessage('Loading the selected concept for your whiteboard…');
    void getConceptGraphNodeActions(getToken, handoff.documentId, handoff.nodeId, handoff.revision).then((resolved) => {
      if (!active) return;
      if (!resolved.board) throw new Error('This saved node has no current source evidence to add.');
      setTarget(resolved.board);
      setTargetOwnerId(ownerId);
      setMessage('');
    }).catch((caught: unknown) => {
      if (active) {
        setMessage('');
        setError(caught instanceof Error ? caught.message : 'This concept is unavailable.');
      }
    });
    return () => { active = false; };
  }, [getToken, handoff, ownerId]);

  async function insert() {
    if (!handoff || !target || targetOwnerId !== ownerId || busy || inserted) return;
    const generation = accountGeneration.current;
    const isCurrentAccount = () => generation === accountGeneration.current && activeOwner.current === ownerId;
    setBusy(true);
    setError('');
    try {
      // Re-resolve at insertion time so an old tab cannot insert stale source text.
      const current = await getConceptGraphNodeActions(getToken, handoff.documentId, handoff.nodeId, handoff.revision);
      if (!isCurrentAccount()) return;
      if (!current.board) throw new Error('The selected concept no longer has available source evidence.');
      onInsert(current.board, current.graph_revision);
      setInserted(true);
      setMessage('The selected concept was added to this account’s local board.');
    } catch (caught) {
      if (isCurrentAccount()) setError(caught instanceof Error ? caught.message : 'The selected concept could not be added.');
    } finally {
      if (isCurrentAccount()) setBusy(false);
    }
  }

  if (!handoff || dismissed) return null;
  return (
    <section className="my-3 rounded border border-blue-300 bg-blue-50 p-3 text-sm" aria-label="Concept board insertion preview">
      <h3 className="font-semibold">Add selected concept to this board</h3>
      <p className="mt-1 text-xs text-neutral-700">Review the content first. Adding it keeps existing board shapes.</p>
      {target && targetOwnerId === ownerId && <><p className="mt-2 font-medium">{target.label}</p><blockquote className="mt-2 border-s-2 border-blue-400 ps-2">{target.quote}</blockquote><p className="mt-1 text-xs text-neutral-600">Source {target.document_id}{target.page === null ? '' : ` · page ${target.page}`}</p></>}
      {message && <p role="status" className="mt-2">{message}</p>}
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="rounded bg-blue-700 px-3 py-1.5 text-white disabled:opacity-50" disabled={!target || targetOwnerId !== ownerId || busy || inserted} onClick={() => void insert()}>{busy ? 'Checking source…' : inserted ? 'Added to board' : 'Insert concept into board'}</button>
        <button type="button" className="rounded border px-3 py-1.5" disabled={busy} onClick={() => setDismissed(true)}>Dismiss preview</button>
      </div>
    </section>
  );
}
