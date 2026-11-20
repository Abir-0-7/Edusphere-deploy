import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, strFromU8, zipSync } from 'fflate';
import { extractDocxXml } from '../src/lib/ocr-docx-worker';
import { readDocxXml } from '../src/lib/ocr-docx';
import { maxDocxXmlBytes } from '../src/lib/ocr-docx-limits';

describe('bounded Word text extraction', () => {
  it('reads compressed XML and never expands unused entries', () => {
    const xml = '<document>English and বাংলা text</document>';
    const archive = zipSync({
      'word/document.xml': strToU8(xml),
      'word/unused-image.bin': new Uint8Array(5 * 1024 * 1024),
    });
    expect(strFromU8(extractDocxXml(archive))).toBe(xml);
  });

  it('enforces actual emitted bytes even when archive size metadata is incorrect', () => {
    const archive = zipSync({ 'word/document.xml': new Uint8Array(maxDocxXmlBytes + 1024).fill(65) });
    const headers = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const centralOffset = headers.getUint32(archive.length - 6, true);
    headers.setUint32(22, 128, true);
    headers.setUint32(centralOffset + 24, 128, true);
    expect(() => extractDocxXml(archive)).toThrow(/under 4 MB/);
  });

  it('rejects oversized, missing, truncated and excessively fragmented document packages', () => {
    expect(() =>
      extractDocxXml(zipSync({ 'word/document.xml': new Uint8Array(maxDocxXmlBytes + 1) })),
    ).toThrow();
    expect(() => extractDocxXml(zipSync({ 'word/other.xml': strToU8('missing') }))).toThrow();
    const valid = zipSync({ 'word/document.xml': strToU8('<document/>') });
    expect(() => extractDocxXml(valid.subarray(0, valid.length - 10))).toThrow();
    const files = Object.fromEntries(
      Array.from({ length: 2_001 }, (_, index) => [`entry-${index}`, new Uint8Array()]),
    );
    expect(() => extractDocxXml(zipSync(files))).toThrow();
  });
});

class DocumentWorker {
  static instances: DocumentWorker[] = [];
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    DocumentWorker.instances.push(this);
  }
}

describe('Word import worker lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    DocumentWorker.instances = [];
  });

  it('terminates on cancellation and ignores a late result', async () => {
    vi.stubGlobal('Worker', DocumentWorker);
    const controller = new AbortController();
    const result = readDocxXml(new File(['fixture'], 'notes.docx'), controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    const worker = DocumentWorker.instances[0]!;
    worker.onmessage?.({ data: { kind: 'result', xml: strToU8('late') } });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates a stalled reader at its deadline and permits another import', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', DocumentWorker);
    const pending = readDocxXml(new File(['fixture'], 'notes.docx'), new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    expect(DocumentWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
    const retry = readDocxXml(new File(['fixture'], 'notes.docx'), new AbortController().signal);
    const xml = strToU8('<document/>');
    DocumentWorker.instances[1]!.onmessage?.({ data: { kind: 'result', xml } });
    await expect(retry).resolves.toEqual(xml);
    expect(DocumentWorker.instances[1]!.terminate).toHaveBeenCalledOnce();
  });
});
