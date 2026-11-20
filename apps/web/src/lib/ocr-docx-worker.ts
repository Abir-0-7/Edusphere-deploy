import { Unzip, UnzipInflate } from 'fflate';
import { maxDocxXmlBytes } from './ocr-docx-limits';

const maxArchiveBytes = 15 * 1024 * 1024;
const maxEntries = 2_000;
const inputChunkBytes = 1024;
const invalidDocument = () => new Error('Use a valid, unencrypted .docx with text under 4 MB.');

function validateArchive(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > maxArchiveBytes) throw invalidDocument();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) throw invalidDocument();
  // Streaming Unzip accepts local records alone; require a complete ordinary ZIP too.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (
      view.getUint32(offset, true) !== 0x06054b50 ||
      offset + 22 + view.getUint16(offset + 20, true) !== bytes.length
    )
      continue;
    if (
      view.getUint16(offset + 4, true) !== 0 ||
      view.getUint16(offset + 6, true) !== 0 ||
      view.getUint16(offset + 8, true) !== view.getUint16(offset + 10, true) ||
      view.getUint16(offset + 10, true) > maxEntries
    )
      throw invalidDocument();
    return;
  }
  throw invalidDocument();
}

/** Metadata is only an early rejection: the emitted bytes enforce the real cap. */
export function extractDocxXml(bytes: Uint8Array): Uint8Array {
  validateArchive(bytes);
  let entries = 0;
  let matches = 0;
  let emitted = 0;
  let complete = false;
  const parts: Uint8Array[] = [];
  const unzip = new Unzip((file) => {
    if (++entries > maxEntries) throw invalidDocument();
    // Do not start decoders for images, relationships, macros, or other unused entries.
    if (file.name !== 'word/document.xml') return;
    if (++matches > 1 || (file.originalSize !== undefined && file.originalSize > maxDocxXmlBytes))
      throw invalidDocument();
    file.ondata = (error, chunk, final) => {
      if (error) throw invalidDocument();
      emitted += chunk.length;
      if (emitted > maxDocxXmlBytes) throw invalidDocument();
      parts.push(chunk.slice());
      if (final) complete = true;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // A small compressed chunk also bounds inflation work between output-size checks.
  for (let offset = 0; offset < bytes.length; offset += inputChunkBytes) {
    const end = Math.min(bytes.length, offset + inputChunkBytes);
    unzip.push(bytes.subarray(offset, end), end === bytes.length);
  }
  if (matches !== 1 || !complete || emitted === 0) throw invalidDocument();
  const xml = new Uint8Array(emitted);
  let offset = 0;
  for (const part of parts) {
    xml.set(part, offset);
    offset += part.length;
  }
  return xml;
}

// The pure extractor is also exercised in Node unit tests, where no worker exists.
if (typeof window === 'undefined' && typeof self !== 'undefined') {
  self.addEventListener(
    'message',
    (event: MessageEvent<{ file: File }>) => {
      void (async () => {
        try {
          const file = event.data.file;
          if (!(file instanceof Blob) || file.size > maxArchiveBytes) throw invalidDocument();
          const xml = extractDocxXml(new Uint8Array(await file.arrayBuffer()));
          self.postMessage({ kind: 'result', xml }, { transfer: [xml.buffer as ArrayBuffer] });
        } catch {
          self.postMessage({ kind: 'error' });
        }
      })();
    },
    { once: true },
  );
}
