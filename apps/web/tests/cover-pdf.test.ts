import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { AcademicCoverDraftSchema } from '../../../packages/types/src/cover-api';
import {
  CoverLayoutOverflowError,
  InvalidCoverLogoError,
  UnsupportedCoverTextError,
  createCoverPdf,
  coverPdfFilename,
  prepareCoverLayout,
  validateCoverLogo,
} from '../src/lib/cover-pdf';
import { COVER_PAPER } from '../src/lib/cover-layout';

vi.mock('@studyvault/types', async () => import('../../../packages/types/src/cover-api'));

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGNgYGD4DwABBAEAqP9cWQAAAABJRU5ErkJggg==';
let pngBytes: Uint8Array;

beforeAll(() => {
  const binary = atob(pngBase64);
  pngBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
});

function contentStreamText(document: PDFDocument, pageIndex = 0): string {
  const page = document.getPage(pageIndex);
  const contents = page.node.Contents();
  if (!contents) return '';
  const streams =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, index) =>
          contents.lookupMaybe(index, PDFRawStream),
        ).filter((stream): stream is PDFRawStream => stream !== undefined)
      : contents instanceof PDFRawStream
        ? [contents]
        : [];
  return streams
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
}

describe('cover PDF export', () => {
  it.each(['a4', 'letter'] as const)(
    'uses the selected %s page size and a single positioned text stream',
    async (pageSize) => {
      const draft = AcademicCoverDraftSchema.parse({
        templateId: 'minimal-professional',
        pageSize,
        content: {
          institutionName: 'North Campus University',
          title: 'A Study of Café Algorithms',
          courseCode: 'CS 240',
          courseName: 'Algorithms',
          students: [{ name: 'Rosa Pérez', id: 'S123', section: 'B' }],
          instructorName: 'Dr. Rahman',
          date: '2026-11-18',
        },
      });
      const layout = await prepareCoverLayout(draft);
      const bytes = await createCoverPdf(draft);
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPage(0)?.getSize()).toEqual(COVER_PAPER[pageSize]);
      expect(layout.overflow).toBe(false);
      expect(layout.lines.map((line) => line.field)).toContain('title');
      const content = contentStreamText(pdf);
      expect((content.match(/\bTj\b/gu) ?? []).length).toBe(layout.lines.length);
      expect(content).toContain(' Tm');
    },
  );

  it('omits all blank optional fields from both the measured layout and PDF text stream', async () => {
    const draft = {
      templateId: 'university-assignment',
      pageSize: 'letter',
      content: { title: 'One title' },
    };
    const layout = await prepareCoverLayout(draft);
    const pdf = await PDFDocument.load(await createCoverPdf(draft));
    const content = contentStreamText(pdf);
    expect(layout.lines.map((line) => line.field)).toEqual(['title']);
    expect((content.match(/\bTj\b/gu) ?? []).length).toBe(1);
  });

  it('reports unsupported script characters with a user-facing error', async () => {
    const draft = {
      templateId: 'university-assignment',
      pageSize: 'a4',
      content: { title: 'বাংলা শিরোনাম' },
    };
    await expect(prepareCoverLayout(draft)).rejects.toBeInstanceOf(UnsupportedCoverTextError);
    await expect(createCoverPdf(draft)).rejects.toBeInstanceOf(UnsupportedCoverTextError);
  });

  it('rejects one-page content overflow instead of producing a clipped file', async () => {
    const draft = {
      templateId: 'university-assignment',
      pageSize: 'letter',
      content: {
        title: 'Field project',
        students: Array.from({ length: 40 }, (_, index) => ({
          name: `Student ${index + 1} ${'Surname '.repeat(18)}`,
        })),
      },
    };
    await expect(createCoverPdf(draft)).rejects.toBeInstanceOf(CoverLayoutOverflowError);
  });

  it('embeds a validated logo without stretching its source aspect ratio or crossing page margins', async () => {
    const asset = validateCoverLogo(pngBytes, 'image/png');
    expect(asset).toMatchObject({ width: 1, height: 1, mimeType: 'image/png' });
    const layout = await prepareCoverLayout(
      {
        templateId: 'project-report',
        pageSize: 'a4',
        content: { title: 'Project' },
      },
      { width: 2400, height: 1200 },
    );
    expect(layout.logo).toMatchObject({ width: 128, height: 64, x: (COVER_PAPER.a4.width - 128) / 2, y: 88 });
    expect(layout.lines[0]?.y).toBeGreaterThanOrEqual(
      layout.logo!.y + layout.logo!.height + 12 + layout.lines[0]!.fontSize,
    );
    const pdf = await PDFDocument.load(
      await createCoverPdf(
        {
          templateId: 'project-report',
          pageSize: 'a4',
          content: { title: 'Project' },
        },
        { logo: asset },
      ),
    );
    expect(contentStreamText(pdf)).toContain(' Do');
  });

  it('rejects unsupported, oversized, malformed, and over-dimension logos before PDF decoding', () => {
    expect(() => validateCoverLogo(pngBytes, 'image/gif')).toThrow(InvalidCoverLogoError);
    expect(() => validateCoverLogo(new Uint8Array(1024 * 1024 + 1), 'image/png')).toThrow(/1 MB/u);
    expect(() => validateCoverLogo(new Uint8Array([1, 2, 3]), 'image/jpeg')).toThrow(/valid PNG or JPEG/u);
    const tooWide = pngBytes.slice();
    tooWide[18] = 0x09;
    tooWide[19] = 0x61;
    expect(() => validateCoverLogo(tooWide, 'image/png')).toThrow(/2400/u);
    const jpegHeader = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11,
      0x00, 0x03, 0x11, 0x00,
    ]);
    expect(validateCoverLogo(jpegHeader, 'image/jpeg')).toMatchObject({
      width: 3,
      height: 2,
      mimeType: 'image/jpeg',
    });
  });

  it('normalizes file names and falls back for punctuation-only titles', () => {
    expect(coverPdfFilename('Café: Algorithms & Data')).toBe('cafe-algorithms-data.pdf');
    expect(coverPdfFilename('বাংলা')).toBe('cover.pdf');
  });
});
