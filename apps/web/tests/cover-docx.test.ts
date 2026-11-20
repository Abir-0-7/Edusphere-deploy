import { describe, expect, it } from 'vitest';
import { createCoverDocx, coverDocxFilename, COVER_DOCX_MIME } from '@/lib/cover-docx';
import { COVER_PALETTES } from '@/lib/cover-decoration';
import { CoverLayoutOverflowError } from '@/lib/cover-pdf';

const templates = ['university-assignment', 'lab-report', 'project-report', 'minimal-professional'] as const;
const draft = {
  templateId: 'university-assignment',
  pageSize: 'a4',
  content: { title: 'Café & Algorithms <Report>' },
};

describe('editable DOCX cover renderer', () => {
  it.each(templates)('uses editable escaped text and canonical page size for %s', async (templateId) => {
    for (const pageSize of ['a4', 'letter']) {
      const bytes = await createCoverDocx({ ...draft, templateId, pageSize });
      expect([...bytes.subarray(0, 4)]).toEqual([80, 75, 3, 4]);
      const packageText = new TextDecoder().decode(bytes);
      expect(
        [...packageText.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/gu)]
          .map((match) => match[1])
          .join(' '),
      ).toBe('Café &amp; Algorithms &lt;Report&gt;');
      expect(packageText).toContain('word/header.xml');
      expect(packageText).toContain('fillcolor="' + COVER_PALETTES[templateId].accent + '"');
      expect(packageText).toContain('<w:color w:val="' + COVER_PALETTES[templateId].heading.slice(1) + '"/>');
      expect(packageText).toContain('<w:pStyle w:val="Title"/>');
      expect(packageText).toContain(
        pageSize === 'a4' ? 'w:w="11906" w:h="16838"' : 'w:w="12240" w:h="15840"',
      );
      expect(packageText).not.toMatch(/w:documentProtection|altChunk|TargetMode="External"|vbaProject/u);
      expect(packageText).not.toContain('word/media/');
    }
  });

  it('fails unsupported glyphs, XML control text and page overflow', async () => {
    await expect(createCoverDocx({ ...draft, content: { title: 'বাংলা' } })).rejects.toThrow('cannot export');
    await expect(createCoverDocx({ ...draft, content: { title: 'Title\u0001' } })).rejects.toThrow();
    await expect(
      createCoverDocx({
        ...draft,
        content: {
          title: 'Long group',
          students: Array.from({ length: 40 }, () => ({
            name: 'Long name '.repeat(16).trim(),
            id: '1234567890'.repeat(8),
            section: 'Long section '.repeat(6).trim(),
          })),
        },
      }),
    ).rejects.toBeInstanceOf(CoverLayoutOverflowError);
  });

  it('rejects logos with a header but invalid image data', async () => {
    const bytes = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 4, 0, 0, 0, 2,
    ]);
    await expect(
      createCoverDocx(draft, { logo: { bytes, width: 4, height: 2, mimeType: 'image/png' } }),
    ).rejects.toThrow('could not be decoded');
  });

  it('uses the DOCX filename and media type', () => {
    expect(coverDocxFilename('Café & report')).toBe('cafe-report.docx');
    expect(COVER_DOCX_MIME).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
});
