import { afterEach, describe, expect, it, vi } from 'vitest';

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));
vi.mock('pdfjs-dist', () => pdfjs);
import { openOcrPdf } from '../src/lib/ocr-documents';

describe('PDF import resource bounds', () => {
  afterEach(() => vi.clearAllMocks());

  it('cancels a stalled text stream and permits a clean extraction retry', async () => {
    const cancel = vi.fn();
    let requested = false;
    const cleanup = vi.fn();
    const streamTextContent = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new ReadableStream({
            pull() {
              requested = true;
              return new Promise(() => {});
            },
            cancel,
          }),
      )
      .mockImplementationOnce(
        () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ items: [{ str: 'Recovered PDF text', hasEOL: true }] });
              controller.close();
            },
          }),
      );
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => ({ streamTextContent, cleanup }) }),
      destroy,
    });
    const file = new File(['%PDF-fixture'], 'notes.pdf');
    const lifetime = new AbortController();
    const pdf = await openOcrPdf(file, lifetime.signal);
    expect(pdfjs.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ maxImageSize: 16_000_000, stopAtErrors: true }),
    );
    const operation = new AbortController();
    const pending = pdf.extractText(() => {}, operation.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(requested).toBe(true));
    operation.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(pdf.extractText(() => {})).resolves.toEqual({
      text: 'Page 1\nRecovered PDF text',
      emptyPages: [],
    });
    await pdf.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
