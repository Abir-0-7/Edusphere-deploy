'use client';

import { useEffect, useState } from 'react';
import type { Flashcard } from '@/lib/ai-types';
import {
  deleteFlashcard,
  editFlashcard,
  reportFlashcard,
  retireFlashcard,
  type GetToken,
} from '@/lib/ai-client';

type Props = {
  card: Flashcard;
  getToken: GetToken;
  onChanged: (card: Flashcard | null) => void;
};

export function FlashcardEditor({ card, getToken, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [tags, setTags] = useState((card.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (editing) return;
    setFront(card.front);
    setBack(card.back);
    setTags((card.tags ?? []).join(', '));
  }, [card.back, card.front, card.tags, editing]);

  async function save() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const updated = await editFlashcard(getToken, card.id, {
        front,
        back,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      });
      onChanged(updated);
      setEditing(false);
      setMessage('Saved. Content changes are flagged for deliberate review.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this card.');
    } finally {
      setBusy(false);
    }
  }

  async function report() {
    setMessage('');
    setError('');
    const reason = window.prompt('What is wrong with this card?')?.trim();
    if (!reason) return;
    setBusy(true);
    setError('');
    try {
      await reportFlashcard(getToken, card.id, reason);
      setMessage('Report received.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not report this card.');
    } finally {
      setBusy(false);
    }
  }

  async function retire() {
    if (!window.confirm('Retire this card from active study?')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const updated = await retireFlashcard(getToken, card.id);
      onChanged(updated);
      setMessage('Card retired.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not retire this card.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this card and its review history?')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await deleteFlashcard(getToken, card.id);
      onChanged(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this card.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {!editing && (
        <>
          <button type="button" className="rounded border px-2 py-1 text-xs" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="rounded border px-2 py-1 text-xs" disabled={busy} onClick={() => void report()}>Report incorrect</button>
          <button type="button" className="rounded border px-2 py-1 text-xs" disabled={busy} onClick={() => void retire()}>Retire</button>
          <button type="button" className="rounded border px-2 py-1 text-xs text-red-700" disabled={busy} onClick={() => void remove()}>Delete</button>
        </>
      )}
      {editing && (
        <div className="w-full space-y-2 rounded border bg-white p-2">
          <label className="block text-xs font-medium">
            Question
            <textarea className="mt-1 block w-full rounded border p-2 text-sm" value={front} maxLength={300} onChange={(event) => setFront(event.target.value)} />
          </label>
          <label className="block text-xs font-medium">
            Answer
            <textarea className="mt-1 block w-full rounded border p-2 text-sm" value={back} maxLength={600} onChange={(event) => setBack(event.target.value)} />
          </label>
          <label className="block text-xs font-medium">
            Tags
            <input className="mt-1 block w-full rounded border p-2 text-sm" value={tags} maxLength={800} onChange={(event) => setTags(event.target.value)} placeholder="biology, exam" />
          </label>
          <div className="flex gap-2">
            <button type="button" className="rounded bg-blue-700 px-2 py-1 text-xs text-white" disabled={busy} onClick={() => void save()}>Save edit</button>
            <button type="button" className="rounded border px-2 py-1 text-xs" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
      {message && <p role="status" className="w-full text-xs text-green-700">{message}</p>}
      {error && <p role="alert" className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}
