'use client';

import { useEffect, useRef, useState } from 'react';
import type { LocalTextImport, SourceVersion } from '@studyvault/types';
import { AiHttpError, type GetToken } from '@/lib/ai-client';
import { importLocalOutlineSource } from '@/lib/course-outline-client';

const maxBytes = 128 * 1024;
const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 py-2 text-slate-950';
const button =
  'rounded-lg border border-emerald-800 px-3 py-2 font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50';
type Format = LocalTextImport['format'];

async function encodeFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 4096)));
  }
  return btoa(chunks.join(''));
}

export function LocalSourceImport({
  getToken,
  onImported,
}: {
  getToken: GetToken;
  onImported: (version: SourceVersion) => void;
}) {
  const [format, setFormat] = useState<Format>('notes');
  const [title, setTitle] = useState('');
  const [rights, setRights] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const activeImport = useRef<AbortController | null>(null);
  useEffect(() => () => activeImport.current?.abort(), []);

  async function submit() {
    if (activeImport.current) return;
    const controller = new AbortController();
    activeImport.current = controller;
    setBusy(true);
    setError('');
    setStatus('');
    const metadata = { title: title.trim(), rights_statement: rights.trim() };
    try {
      let body: LocalTextImport;
      if (format === 'notes') {
        if (new TextEncoder().encode(text).byteLength > maxBytes)
          throw new Error('Notes must be 128 KiB or smaller.');
        body = { ...metadata, format, text };
      } else {
        if (!file || file.size < 1 || file.size > maxBytes)
          throw new Error('Choose a file between 1 byte and 128 KiB.');
        const content = { ...metadata, filename: file.name, content_base64: await encodeFile(file) };
        if (format === 'epub') body = { ...content, format, media_type: 'application/epub+zip' };
        else if (format === 'html') body = { ...content, format, media_type: 'text/html' };
        else body = { ...content, format, media_type: 'text/plain' };
      }
      if (controller.signal.aborted) return;
      const version = await importLocalOutlineSource(getToken, body, controller.signal);
      if (!controller.signal.aborted) {
        onImported(version);
        setStatus((version.snapshot.provenance.extraction_notes ?? []).join(' '));
        setText('');
        setFile(null);
      }
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof AiHttpError && cause.status === 404
            ? 'Local source import is unavailable here.'
            : cause instanceof Error
              ? cause.message
              : 'Could not import the source.',
        );
      }
    } finally {
      if (activeImport.current === controller) {
        activeImport.current = null;
        setBusy(false);
      }
    }
  }

  const accept = format === 'epub' ? '.epub' : format === 'html' ? '.html,.htm' : '.txt';
  return (
    <details className="rounded-lg border bg-white p-3">
      <summary className="cursor-pointer font-medium">Import notes or a local file</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-slate-700">
          Files stay private. Saved HTML and EPUB use extracted text line references. Images, scripts,
          styling, and complex table layout may be omitted.
        </p>
        <label className="block text-sm">
          Source format
          <select
            className={field}
            value={format}
            disabled={busy}
            onChange={(event) => {
              setFormat(event.target.value as Format);
              setFile(null);
              setError('');
            }}
          >
            <option value="notes">Pasted notes</option>
            <option value="txt">Plain text file</option>
            <option value="html">Saved HTML page</option>
            <option value="epub">EPUB 3 book</option>
          </select>
        </label>
        <label className="block text-sm">
          Source title
          <input
            className={field}
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {format === 'notes' ? (
          <label className="block text-sm">
            Notes text
            <textarea
              className={field}
              value={text}
              rows={4}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        ) : (
          <label className="block text-sm">
            Source file, up to 128 KiB
            <input
              key={format + (file ? 'selected' : 'empty')}
              className={field}
              type="file"
              accept={accept}
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        )}
        {file ? <p className="break-words text-sm">{file.name}</p> : null}
        <label className="block text-sm">
          Why are you allowed to use this source for private study?
          <textarea
            className={field}
            rows={2}
            value={rights}
            maxLength={1000}
            disabled={busy}
            onChange={(event) => setRights(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            onClick={() => void submit()}
            disabled={busy || !title.trim() || !rights.trim() || (format === 'notes' ? !text.trim() : !file)}
          >
            {busy ? 'Importing source' : 'Import source'}
          </button>
          {busy ? (
            <button
              type="button"
              className={button}
              onClick={() => {
                activeImport.current?.abort();
                activeImport.current = null;
                setBusy(false);
                setStatus('Import cancelled. Reload your sources to check for a completed save.');
              }}
            >
              Cancel import
            </button>
          ) : null}
        </div>
        {status ? (
          <p role="status" className="text-sm text-slate-700">
            {status}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-red-900">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
