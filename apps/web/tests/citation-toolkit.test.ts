import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  citationLimits,
  exportCitationData,
  formatCitation,
  normalizeIdentifier,
  normalizeUrl,
  parseCitationImport,
} from '../src/lib/citation-toolkit';
import type { BibliographyItem, BibliographyItemInput } from '@studyvault/types';
import { citationGolden, ieeeSecondCitation } from './fixtures/citation-golden-fixtures';

const now = '2026-11-19T00:00:00.000Z';
const styleAssets = new Map([
  ['/csl/apa.csl', new URL('../public/csl/apa.csl', import.meta.url)],
  [
    '/csl/modern-language-association.csl',
    new URL('../public/csl/modern-language-association.csl', import.meta.url),
  ],
  ['/csl/ieee.csl', new URL('../public/csl/ieee.csl', import.meta.url)],
  ['/csl/locales-en-US.xml', new URL('../public/csl/locales-en-US.xml', import.meta.url)],
]);

function record(input: Partial<BibliographyItemInput> = {}, id = 'ref-1'): BibliographyItem {
  return {
    id,
    revision: 1,
    created_at: now,
    updated_at: now,
    kind: 'book',
    title: 'Algorithms in Plain English',
    authors: [{ family: 'Lovelace', given: 'Ada', literal: undefined, suffix: undefined }],
    issued: { year: 1843, month: undefined, day: undefined, literal: undefined },
    container_title: '',
    edition: '',
    volume: '',
    issue: '',
    item_pages: '12-28',
    publisher: 'Example Press',
    doi: '10.1234/example',
    isbn: '9780306406157',
    url: '',
    accessed: null,
    repository_commit: '',
    source_document_id: null,
    metadata_provenance: [],
    metadata_suggestions: [],
    ...input,
  };
}

async function mockStyleAssets() {
  const fetchMock = vi.fn(async (resource: string | URL | Request) => {
    const url = new URL(String(resource), 'http://localhost');
    const asset = styleAssets.get(url.pathname);
    return asset ? new Response(await readFile(asset)) : new Response('missing', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('deterministic citation toolkit', () => {
  it('renders golden APA, MLA and IEEE citations and bibliographies with a page locator', async () => {
    await mockStyleAssets();
    const item = record();
    const apa = await formatCitation([item], item.id, 'apa', '14');
    const mla = await formatCitation([item], item.id, 'mla', '14');
    const ieee = await formatCitation([item], item.id, 'ieee', '14');
    expect(apa).toEqual(citationGolden.apa);
    expect(mla).toEqual(citationGolden.mla);
    expect(ieee).toEqual(citationGolden.ieee);
  });

  it('keeps IEEE citation numbers aligned with the multi-item bibliography order', async () => {
    await mockStyleAssets();
    const first = record(
      {
        title: 'Computing Machinery',
        authors: [{ family: 'Hopper', given: 'Grace', literal: undefined, suffix: undefined }],
        issued: { year: 1936, month: undefined, day: undefined, literal: undefined },
        doi: '',
        isbn: '',
      },
      'ref-first',
    );
    const second = record({ title: 'Algorithms in Plain English' }, 'ref-second');
    const result = await formatCitation([first, second], second.id, 'ieee', '14');
    expect(result.citation).toBe(ieeeSecondCitation);
    expect(result.bibliography).toMatch(
      /^\[1\] .*Computing Machinery[\s\S]*\[2\] .*Algorithms in Plain English/,
    );
  });

  it('normalizes DOI, URL, ISBN and checksum locally without external lookup', () => {
    expect(normalizeIdentifier('doi', 'https://doi.org/10.1234/AbC.', 'journal_article').doi).toBe(
      '10.1234/abc',
    );
    expect(normalizeIdentifier('isbn', 'ISBN-10: 0-306-40615-2', 'book').isbn).toBe('9780306406157');
    expect(normalizeIdentifier('url', 'https://example.org/path#section', 'website').url).toBe(
      'https://example.org/path#section',
    );
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(() => normalizeIdentifier('isbn', '9780306406158', 'book')).toThrow(/check digit/);
  });

  it('imports BibTeX and RIS into preview records without filling absent dates', () => {
    const bibtex =
      '@book{ada, title={Algorithms in Plain English}, author={Lovelace, Ada}, isbn={0-306-40615-2}}';
    const ris =
      'TY  - BOOK\nTI  - Algorithms in Plain English\nAU  - Lovelace, Ada\nSN  - 9780306406157\nER  -';
    const bib = parseCitationImport(bibtex, 'bibtex', []);
    const risItems = parseCitationImport(ris, 'ris', []);
    expect(bib).toHaveLength(1);
    expect(bib[0]?.input).toMatchObject({
      title: 'Algorithms in Plain English',
      issued: null,
      isbn: '9780306406157',
    });
    expect(risItems[0]?.input).toMatchObject({
      title: 'Algorithms in Plain English',
      issued: null,
      isbn: '9780306406157',
    });
  });

  it('suggests duplicate matches and keeps all record mutations explicit', () => {
    const existing = record();
    const imported = parseCitationImport(
      '@book{new, title={Algorithms in Plain English}, author={Lovelace, Ada}, doi={https://doi.org/10.1234/EXAMPLE}}',
      'bibtex',
      [existing],
    );
    expect(imported[0]?.duplicate).toEqual({ itemId: existing.id, reason: 'doi' });
  });

  it('round-trips BibTeX, RIS and CSL-JSON exports by record identifiers', () => {
    const item = record();
    for (const format of ['bibtex', 'ris', 'csl_json'] as const) {
      const exported = exportCitationData([item], format);
      const imported = parseCitationImport(exported, format, []);
      expect(imported).toHaveLength(1);
      expect(imported[0]?.input).toMatchObject({
        title: item.title,
        authors: item.authors,
        issued: item.issued,
        doi: item.doi,
        isbn: item.isbn,
        item_pages: item.item_pages,
      });
    }
  });

  it('enforces byte and per-batch record limits and rejects malformed input', () => {
    expect(citationLimits).toEqual({ maxImportBytes: 256 * 1024, maxImportRecords: 50 });
    expect(() => parseCitationImport('x'.repeat(256 * 1024 + 1), 'bibtex', [])).toThrow(/256 KiB/);
    const tooMany = Array.from({ length: 51 }, (_, i) => `@book{r${i}, title={Title ${i}}}`).join('\n');
    expect(() => parseCitationImport(tooMany, 'bibtex', [])).toThrow(/50 records/);
    expect(() => parseCitationImport('{broken', 'csl_json', [])).toThrow(/Could not parse/);
  });

  it('does not fabricate citation output from records without identifying data', async () => {
    await mockStyleAssets();
    const blank = record({ title: '', authors: [], issued: null, doi: '', isbn: '' });
    await expect(formatCitation([blank], blank.id, 'apa')).rejects.toThrow(/Add at least one/);
  });
});
