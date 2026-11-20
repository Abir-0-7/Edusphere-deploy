import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { readDocxXml } from './ocr-docx';
import { maxImagePixels } from './ocr-image';

export type OcrSourceFormat = 'image' | 'pdf' | 'docx';
export const maxDocumentBytes = 15 * 1024 * 1024;
export const maxPdfPages = 30;
const maxWordXmlBytes = 4 * 1024 * 1024;
const maxExtractedCharacters = 500_000;
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function validateOcrDocument(file: Pick<File, 'size' | 'name'>, format: 'pdf' | 'docx') {
  if (file.size === 0 || file.size > maxDocumentBytes)
    throw new Error('Choose a nonempty document that is 15 MB or smaller.');
  if (!file.name.toLowerCase().endsWith(`.${format}`)) {
    throw new Error(
      format === 'docx'
        ? 'Choose a .docx Word document. For .doc or Google Docs, download or save a .docx or PDF first.'
        : 'Choose a .pdf document.',
    );
  }
}

export async function readDocxText(file: File, signal: AbortSignal): Promise<string> {
  validateOcrDocument(file, 'docx');
  const documentXml = await readDocxXml(file, signal);
  signal.throwIfAborted();
  if (!documentXml?.length || documentXml.length > maxWordXmlBytes)
    throw new Error('This file does not contain readable Word document text.');
  const encoding =
    documentXml[0] === 0xff && documentXml[1] === 0xfe
      ? 'utf-16le'
      : documentXml[0] === 0xfe && documentXml[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  let xml: string;
  try {
    xml = new TextDecoder(encoding, { fatal: true }).decode(documentXml);
  } catch {
    throw new Error('The Word document has an unsupported text encoding. Save it as a new .docx and retry.');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('This Word document uses unsupported XML declarations.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length)
    throw new Error('The Word document text is damaged. Save it as a new .docx and retry.');
  const paragraphs = Array.from(document.getElementsByTagNameNS(wordNamespace, 'p'));
  // Extract text only: never render document HTML, follow relationships, or execute embedded content.
  const text = paragraphs
    .map((paragraph) => {
      let line = '';
      const visit = (node: Element) => {
        if (node.namespaceURI === wordNamespace) {
          if (node.localName === 'del') return;
          if (node.localName === 't') {
            line += node.textContent ?? '';
            return;
          }
          if (node.localName === 'tab') line += '\t';
          if (node.localName === 'br' || node.localName === 'cr') line += '\n';
          if (node !== paragraph && node.localName === 'p') return;
        }
        for (const child of Array.from(node.children)) visit(child);
      };
      visit(paragraph);
      return line.trim();
    })
    .filter(Boolean)
    .join('\n\n');
  if (text.length > maxExtractedCharacters)
    throw new Error('This document has too much text. Split it into smaller documents and retry.');
  if (!text.trim())
    throw new Error(
      'No selectable text was found in this Word document. For scanned pages, export it as PDF and use PDF OCR.',
    );
  return text;
}

export type PdfText = { text: string; emptyPages: number[] };
export type OcrPdf = {
  pageCount: number;
  renderPage: (page: number, signal?: AbortSignal) => Promise<ImageBitmap>;
  pageWarning: (page: number) => string | null;
  extractText: (onPage: (page: number) => void, signal?: AbortSignal) => Promise<PdfText>;
  destroy: () => Promise<void>;
};

export async function openOcrPdf(file: File, signal: AbortSignal): Promise<OcrPdf> {
  validateOcrDocument(file, 'pdf');
  const pdfjs = await import('pdfjs-dist');
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  pdfjs.GlobalWorkerOptions.workerSrc = '/ocr/pdf/pdf.worker.min.mjs';
  const task: PDFDocumentLoadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
    maxImageSize: maxImagePixels,
    stopAtErrors: true,
    cMapUrl: '/ocr/pdf/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/ocr/pdf/standard_fonts/',
    wasmUrl: '/ocr/pdf/wasm/',
    iccUrl: '/ocr/pdf/iccs/',
  });
  const abort = () => void task.destroy().catch(() => {});
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let rejectPassword: (reason: Error) => void = () => {};
  const passwordRequired = new Promise<never>((_, reject) => {
    rejectPassword = reject;
  });
  task.onPassword = () =>
    rejectPassword(new Error('Password-protected PDFs are not supported. Import an unlocked copy.'));
  let pdf: PDFDocumentProxy;
  try {
    pdf = await Promise.race([task.promise, passwordRequired]);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (pdf.numPages > maxPdfPages)
      throw new Error(
        `Choose a PDF with ${maxPdfPages} pages or fewer. Split a longer PDF before importing.`,
      );
  } catch (cause) {
    signal.removeEventListener('abort', abort);
    await task.destroy();
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (cause instanceof Error && /Password-protected|pages or fewer/.test(cause.message)) throw cause;
    throw new Error('Could not open this PDF. Use a valid, unlocked PDF and retry.');
  }
  const pageWarnings = new Map<number, string>();
  return {
    pageCount: pdf.numPages,
    pageWarning: (number) => pageWarnings.get(number) ?? null,
    async destroy() {
      signal.removeEventListener('abort', abort);
      await task.destroy();
    },
    async renderPage(number, operationSignal = signal) {
      operationSignal.throwIfAborted();
      const page = await pdf.getPage(number);
      operationSignal.throwIfAborted();
      const operators = await page.getOperatorList();
      operationSignal.throwIfAborted();
      if (!operators.fnArray.length)
        pageWarnings.set(
          number,
          'This PDF page is blank or has no supported content. Images over 16 million pixels are excluded; resize oversized images or choose another page.',
        );
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(2, 2_000 / Math.max(original.width, original.height)),
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const render = page.render({ canvas, viewport });
      const cancel = () => render.cancel();
      operationSignal.addEventListener('abort', cancel, { once: true });
      if (operationSignal.aborted) cancel();
      try {
        await render.promise;
        operationSignal.throwIfAborted();
        return await createImageBitmap(canvas);
      } catch (cause) {
        if (cause instanceof Error && /maximum allowed size/.test(cause.message))
          throw new Error(
            'This PDF contains an image over 16 million pixels. Resize its images or split it into smaller PDFs before importing.',
          );
        throw cause;
      } finally {
        operationSignal.removeEventListener('abort', cancel);
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    },
    async extractText(onPage, operationSignal = signal) {
      const pages: string[] = [];
      const emptyPages: number[] = [];
      let characters = 0;
      for (let number = 1; number <= pdf.numPages; number += 1) {
        operationSignal.throwIfAborted();
        const page = await pdf.getPage(number);
        try {
          const reader = page.streamTextContent().getReader();
          const cancel = () => void reader.cancel('Import cancelled').catch(() => {});
          operationSignal.addEventListener('abort', cancel, { once: true });
          if (operationSignal.aborted) cancel();
          let text = '';
          try {
            while (true) {
              const chunk = await reader.read();
              operationSignal.throwIfAborted();
              if (chunk.done) break;
              const content = chunk.value as Awaited<ReturnType<typeof page.getTextContent>>;
              const next = content.items
                .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
                .join('');
              characters += next.length;
              if (characters > maxExtractedCharacters)
                throw new Error('This PDF has too much text. Split it into smaller documents and retry.');
              text += next;
            }
          } finally {
            operationSignal.removeEventListener('abort', cancel);
            cancel();
          }
          text = text.trim();
          if (text) pages.push(`Page ${number}\n${text}`);
          else emptyPages.push(number);
          onPage(number);
        } finally {
          page.cleanup();
        }
      }
      return { text: pages.join('\n\n'), emptyPages };
    },
  };
}
