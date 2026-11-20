'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BoardLearningResponseSchema,
  BoardLearningRequestSchema,
  type BoardLearningAction,
  type BoardLearningResponse,
} from '@studyvault/types';
import { authFetch, readResponse, type GetToken } from '@/lib/ai-client';

export type BoardLearningScope = { boardId: string; revision: number; shapeIds: string[]; key: string };

const button = 'rounded border px-3 py-1.5 font-medium disabled:opacity-60';
const actionLabel = { tutor: 'Tutor answer', cards: 'Flashcards', map: 'Concept map' } as const;

function citations(preview: BoardLearningResponse, ids: string[]) {
  return ids.map((id) => preview.excerpts.findIndex((excerpt) => excerpt.id === id) + 1).join(', ');
}

export function WhiteboardSelectionLearning({
  getToken,
  selectionCount,
  getScope,
  onAccept,
}: {
  getToken: GetToken;
  selectionCount: number;
  getScope: () => BoardLearningScope | null;
  onAccept: (preview: BoardLearningResponse, expected: BoardLearningScope) => Promise<void>;
}) {
  const [action, setAction] = useState<BoardLearningAction>('tutor');
  const [question, setQuestion] = useState('');
  const [preview, setPreview] = useState<{ result: BoardLearningResponse; scope: BoardLearningScope } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const currentScope = getScope();
  const current = preview && preview.scope.key === currentScope?.key ? preview : null;

  async function review() {
    if (operation.current || busy) return;
    const scope = getScope();
    if (!scope) {
      setError('Select saved text and wait for the board to finish syncing.');
      return;
    }
    if (scope.shapeIds.length > 20) {
      setError('Select up to 20 text shapes.');
      return;
    }
    const parsed = BoardLearningRequestSchema.safeParse({
      action,
      revision: scope.revision,
      shape_ids: scope.shapeIds,
      ...(action === 'tutor' ? { question: question.trim() } : {}),
    });
    if (!parsed.success) {
      setError('Check the selected text and enter a question of up to 240 characters.');
      return;
    }
    const request = new AbortController();
    operation.current = request;
    setBusy(true);
    setPreview(null);
    setError('');
    setNotice('');
    try {
      const response = await authFetch(getToken, `/api/whiteboards/${scope.boardId}/learning-preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
        signal: request.signal,
      });
      const result = await readResponse(response, BoardLearningResponseSchema, 'board learning preview');
      if (request.signal.aborted) return;
      if (
        result.board_id !== scope.boardId ||
        result.revision !== scope.revision ||
        result.action !== action ||
        result.excerpts.some((excerpt) => !scope.shapeIds.includes(excerpt.id)) ||
        getScope()?.key !== scope.key
      ) {
        throw new Error('The board or selection changed. Review the current area again.');
      }
      setPreview({ result, scope });
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not prepare the learning preview.');
    } finally {
      if (operation.current === request) {
        operation.current = null;
        setBusy(false);
      }
    }
  }

  async function accept() {
    if (!current || operation.current || busy) return;
    setBusy(true);
    setError('');
    try {
      await onAccept(current.result, current.scope);
      setNotice(`${actionLabel[current.result.action]} added to the board.`);
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the reviewed shapes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded border p-2 text-sm">
      <summary className="cursor-pointer font-semibold">Study selected area</summary>
      <div className="mt-2 space-y-2">
        <p>
          {selectionCount
            ? `${selectionCount} text ${selectionCount === 1 ? 'shape' : 'shapes'} selected.`
            : 'Select text, labelled shapes or a frame in the board.'}
        </p>
        <p>
          Suggestions use only your selected board text. Review them before adding shapes; these cards do not
          change your scheduled review deck.
        </p>
        <label className="block">
          Learning action
          <select
            value={action}
            disabled={busy}
            className="ms-2 rounded border p-1"
            onChange={(event) => {
              const value = event.target.value;
              setAction(value === 'cards' || value === 'map' ? value : 'tutor');
              setPreview(null);
              setNotice('');
            }}
          >
            <option value="tutor">Ask the tutor</option>
            <option value="cards">Make flashcards</option>
            <option value="map">Build a concept map</option>
          </select>
        </label>
        {action === 'tutor' ? (
          <label className="block">
            Question for selected text
            <input
              type="text"
              className="mt-1 block w-full rounded border p-1"
              maxLength={240}
              value={question}
              disabled={busy}
              onChange={(event) => {
                setQuestion(event.target.value);
                setPreview(null);
              }}
            />
          </label>
        ) : null}
        {selectionCount > 0 && !currentScope ? (
          <p>Save the board and finish syncing before requesting a preview.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            disabled={busy || !currentScope || (action === 'tutor' && !question.trim())}
            onClick={() => void review()}
          >
            {busy && !current ? 'Preparing preview…' : 'Preview learning action'}
          </button>
          {operation.current ? (
            <button
              type="button"
              className={button}
              onClick={() => {
                operation.current?.abort();
                operation.current = null;
                setBusy(false);
              }}
            >
              Cancel preview
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-red-800">
            {error}
          </p>
        ) : null}
        {notice ? <p aria-live="polite">{notice}</p> : null}
        {preview && !current ? <p>The board or selection changed. Prepare a fresh preview.</p> : null}
        {current ? (
          <section
            className="space-y-2 rounded border border-blue-300 bg-blue-50 p-3"
            aria-label="Selected area learning preview"
          >
            <h3 className="font-semibold">{actionLabel[current.result.action]} preview</h3>
            {current.result.answer ? (
              <p className="whitespace-pre-wrap break-words">
                {current.result.answer} ({citations(current.result, current.result.answer_excerpt_ids)})
              </p>
            ) : null}
            {current.result.cards.length ? (
              <ul className="space-y-2">
                {current.result.cards.map((card, index) => (
                  <li key={index}>
                    <p className="break-words font-medium">{card.front}</p>
                    <p className="whitespace-pre-wrap break-words">
                      {card.back} ({citations(current.result, card.excerpt_ids)})
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
            {current.result.nodes.length ? (
              <ul className="list-disc space-y-1 ps-5">
                {current.result.nodes.map((node, index) => (
                  <li key={index} className="break-words">
                    {node.label} ({citations(current.result, node.excerpt_ids)})
                  </li>
                ))}
              </ul>
            ) : null}
            <details className="break-words">
              <summary className="cursor-pointer font-medium">Review selected sources</summary>
              <ol className="list-decimal space-y-1 ps-5">
                {current.result.excerpts.map((excerpt) => (
                  <li key={excerpt.id}>{excerpt.text}</li>
                ))}
              </ol>
            </details>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={button} disabled={busy} onClick={() => void accept()}>
                Add reviewed shapes
              </button>
              <button type="button" className={button} disabled={busy} onClick={() => setPreview(null)}>
                Discard preview
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}
