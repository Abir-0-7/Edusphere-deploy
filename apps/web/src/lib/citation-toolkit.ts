import { Cite, plugins, type CSL } from '@citation-js/core';
import '@citation-js/plugin-csl';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-ris';
import {
  BibliographyItemInputSchema,
  normalizeIsbn,
  type BibliographyAuthor,
  type BibliographyDate,
  type BibliographyField,
  type BibliographyItem,
  type BibliographyItemInput,
  type BibliographyItemKind,
} from '@studyvault/types';

export type CitationStyle = 'apa' | 'mla' | 'ieee';
export type CitationImportFormat = 'bibtex' | 'ris' | 'csl_json';
export type CitationExportFormat = CitationImportFormat;
export type ImportedCitation = {
  input: BibliographyItemInput;
  source: CitationImportFormat;
  warnings: string[];
  duplicate: { itemId: string; reason: 'doi' | 'isbn' | 'title' } | null;
};

const MAX_IMPORT_BYTES = 256 * 1024;
const MAX_IMPORT_RECORDS = 50;
const styleFiles: Record<CitationStyle, { file: string; hash: string }> = {
  apa: { file: '/csl/apa.csl', hash: '3917def5fc951b104d64216c3373096042368b9704ba269ca83c14ebaba889fc' },
  mla: {
    file: '/csl/modern-language-association.csl',
    hash: 'e1432698ef28938d044b06bd45ddcc57d6b974cec25f71007075646a11f99484',
  },
  ieee: { file: '/csl/ieee.csl', hash: 'b4c7619fc16c45a31e4cc3271eab94ffe83192d3b4c7fc729470a3b459448de3' },
};
const localeFile = {
  file: '/csl/locales-en-US.xml',
  hash: 'ac864c7c21166b4390d82c31792cdc509400727fa0060b43d8aa17e07f9cb079',
};
const styleNames: Record<CitationStyle, string> = {
  apa: 'studyvault-apa-7',
  mla: 'studyvault-mla-9',
  ieee: 'studyvault-ieee-2023',
};
let loadedAssets: Promise<void> | undefined;

async function fetchPinned(file: string, hash: string): Promise<string> {
  const response = await fetch(file, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`The citation asset ${file} could not be loaded.`);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== hash) throw new Error(`The citation asset ${file} failed its integrity check.`);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function ensureAssets(): Promise<void> {
  if (!loadedAssets) {
    loadedAssets = (async () => {
      const [apa, mla, ieee, locale] = await Promise.all([
        fetchPinned(styleFiles.apa.file, styleFiles.apa.hash),
        fetchPinned(styleFiles.mla.file, styleFiles.mla.hash),
        fetchPinned(styleFiles.ieee.file, styleFiles.ieee.hash),
        fetchPinned(localeFile.file, localeFile.hash),
      ]);
      const config = plugins.config.get('@csl');
      for (const [name, xml] of Object.entries({
        [styleNames.apa]: apa,
        [styleNames.mla]: mla,
        [styleNames.ieee]: ieee,
      })) {
        if (!config.styles.has(name)) config.styles.add(name, xml);
      }
      config.locales.set('en-US', locale);
    })().catch((error: unknown) => {
      loadedAssets = undefined;
      throw error;
    });
  }
  await loadedAssets;
}

function normalizeDoi(value: string): string | null {
  let doi = value.trim().replace(/^doi:\s*/i, '');
  doi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  doi = doi.replace(/[\s<>{}"'\]]+$/g, '').replace(/[.,;:]+$/g, '');
  while (doi.endsWith(')') && (doi.match(/\(/g)?.length ?? 0) < (doi.match(/\)/g)?.length ?? 0)) {
    doi = doi.slice(0, -1);
  }
  return /^10\.\d{4,9}\/[^\s]+$/i.test(doi) ? doi.toLowerCase() : null;
}

export type IdentifierKind = 'doi' | 'url' | 'isbn';

export function normalizeIdentifier(
  kind: IdentifierKind,
  rawValue: string,
  recordKind: BibliographyItemKind,
): BibliographyItemInput {
  const value = rawValue.trim().slice(0, kind === 'url' ? 2048 : 300);
  if (!value) throw new Error('Enter an identifier to normalize.');
  const common = {
    kind: recordKind,
    title: '',
    authors: [],
    issued: null,
    container_title: '',
    edition: '',
    volume: '',
    issue: '',
    item_pages: '',
    publisher: '',
    doi: '',
    isbn: '',
    url: '',
    accessed: null,
    repository_commit: '',
    source_document_id: null,
    metadata_provenance: [],
    metadata_suggestions: [],
  };
  if (kind === 'doi') {
    const doi = normalizeDoi(value);
    if (!doi) throw new Error('Enter a DOI in the form 10.xxxx/identifier or a doi.org link.');
    return BibliographyItemInputSchema.parse({
      ...common,
      doi,
      metadata_provenance: [{ field: 'doi', source: 'doi', confirmed: true }],
    });
  }
  if (kind === 'isbn') {
    const isbn = normalizeIsbn(value.replace(/^isbn(?:-1[03])?:?\s*/i, ''));
    if (!isbn) throw new Error('Enter a valid ISBN-10 or ISBN-13 with a correct check digit.');
    return BibliographyItemInputSchema.parse({
      ...common,
      isbn,
      metadata_provenance: [{ field: 'isbn', source: 'isbn', confirmed: true }],
    });
  }
  const url = normalizeUrl(value);
  if (!url) throw new Error('Enter an absolute HTTP(S) URL without embedded credentials.');
  return BibliographyItemInputSchema.parse({
    ...common,
    url,
    metadata_provenance: [{ field: 'url', source: 'url', confirmed: true }],
  });
}

export function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password)
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

const kindToType: Record<BibliographyItemKind, CSL['type']> = {
  book: 'book',
  book_chapter: 'chapter',
  journal_article: 'article-journal',
  website: 'webpage',
  repository: 'software',
};

function dateToCsl(date: BibliographyDate | null | undefined): CSL['issued'] | undefined {
  if (!date) return undefined;
  if (date.literal) return { literal: date.literal };
  if (date.year === undefined) return undefined;
  const parts: [number] | [number, number] | [number, number, number] =
    date.day && date.month
      ? [date.year, date.month, date.day]
      : date.month
        ? [date.year, date.month]
        : [date.year];
  return { 'date-parts': [parts] };
}

export function itemToCsl(item: BibliographyItem): CSL {
  const value: CSL = {
    id: item.id,
    type: kindToType[item.kind],
    title: item.title,
    author: item.authors.map((author) => ({
      ...(author.family ? { family: author.family } : {}),
      ...(author.given ? { given: author.given } : {}),
      ...(author.literal ? { literal: author.literal } : {}),
      ...(author.suffix ? { suffix: author.suffix } : {}),
    })),
    page: item.item_pages,
    publisher: item.publisher,
  };
  if (item.issued) value.issued = dateToCsl(item.issued);
  if (item.accessed) value.accessed = dateToCsl(item.accessed);
  if (item.container_title) value['container-title'] = item.container_title;
  if (item.edition) value.edition = item.edition;
  if (item.volume) value.volume = item.volume;
  if (item.issue) value.issue = item.issue;
  if (item.doi) value.DOI = normalizeDoi(item.doi) ?? item.doi;
  if (item.isbn) value.ISBN = normalizeIsbn(item.isbn) ?? item.isbn;
  if (item.url) value.URL = normalizeUrl(item.url) ?? item.url;
  if (item.repository_commit) value.version = item.repository_commit;
  return value;
}

function completeItems(items: BibliographyItem[]): CSL[] {
  const complete = items.filter(
    (item) => item.title.trim() || item.authors.length || item.issued || item.doi || item.isbn,
  );
  if (!complete.length)
    throw new Error('Add at least one title, author, date, DOI or ISBN before formatting citations.');
  return complete.map(itemToCsl);
}

export async function formatCitation(
  items: BibliographyItem[],
  selectedId: string,
  style: CitationStyle,
  locator = '',
): Promise<{ citation: string; bibliography: string }> {
  await ensureAssets();
  const records = completeItems(items);
  const selected = items.find((item) => item.id === selectedId);
  if (!selected || !records.some((record) => record.id === selected.id)) {
    throw new Error('Select a saved reference to format an in-text citation.');
  }
  const cite = new Cite(records);
  const citationItem = {
    id: selected.id,
    ...(locator.trim() ? { locator: locator.trim(), label: 'page' as const } : {}),
  };
  const selectedIndex = items.findIndex((item) => item.id === selected.id);
  const citationsPre = items.slice(0, selectedIndex).map((item) => ({ id: item.id }));
  return {
    citation: cite.format('citation', {
      style: styleNames[style],
      lang: 'en-US',
      entry: citationItem,
      citationsPre,
      citationsPost: [],
    }),
    bibliography: cite.format('bibliography', { style: styleNames[style], lang: 'en-US' }),
  };
}

export function exportCitationData(items: BibliographyItem[], format: CitationExportFormat): string {
  const cite = new Cite(completeItems(items));
  if (format === 'csl_json') return JSON.stringify(cite.data, null, 2);
  return cite.format(format === 'bibtex' ? 'bibtex' : 'ris');
}

function text(value: unknown, maxLength = 2000): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maxLength);
}

function cslDate(value: unknown): BibliographyDate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const date = value as Record<string, unknown>;
  const parts = date['date-parts'];
  const first = Array.isArray(parts) && Array.isArray(parts[0]) ? parts[0] : null;
  if (first?.length && Number.isInteger(Number(first[0])) && Number(first[0]) > 0) {
    return {
      year: Number(first[0]),
      month: first[1] !== undefined ? Number(first[1]) : undefined,
      day: first[2] !== undefined ? Number(first[2]) : undefined,
      literal: undefined,
    };
  }
  const literal = text(date.literal ?? date.raw, 120);
  return literal ? { year: undefined, month: undefined, day: undefined, literal } : null;
}

function cslAuthors(value: unknown): BibliographyAuthor[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap((candidate): BibliographyAuthor[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const author = candidate as Record<string, unknown>;
    const literal = text(author.literal, 240);
    if (literal) return [{ family: undefined, given: undefined, literal, suffix: undefined }];
    const family = text(author.family, 160);
    const given = text(author.given, 160);
    const suffix = text(author.suffix, 40);
    return family || given ? [{ family, given, literal: undefined, suffix: suffix || undefined }] : [];
  });
}

function kindFromCsl(type: string): BibliographyItemKind | null {
  if (type === 'chapter') return 'book_chapter';
  if (type === 'article-journal' || type === 'article-magazine' || type === 'article-newspaper')
    return 'journal_article';
  if (type === 'software' || type === 'dataset') return 'repository';
  if (type === 'book') return 'book';
  if (type === 'webpage' || type === 'post-weblog') return 'website';
  return null;
}

function importOne(
  record: CSL,
  source: CitationImportFormat,
  existing: BibliographyItem[],
): ImportedCitation {
  const warnings: string[] = [];
  const doi = normalizeDoi(text(record.DOI, 300));
  const isbn = normalizeIsbn(text(record.ISBN, 40));
  const url = normalizeUrl(text(record.URL, 2048));
  const kind = kindFromCsl(text(record.type, 80));
  if (!kind)
    throw new Error(
      `The imported CSL type "${text(record.type, 80) || 'missing'}" is not supported. Choose one of the supported record types manually.`,
    );
  if (record.DOI && !doi) warnings.push('An invalid DOI was omitted for manual review.');
  if (record.ISBN && !isbn) warnings.push('An invalid ISBN was omitted for manual review.');
  if (record.URL && !url) warnings.push('A non-HTTP(S) URL was omitted for manual review.');
  const author = cslAuthors(record.author);
  const date = cslDate(record.issued);
  const input = BibliographyItemInputSchema.parse({
    kind,
    title: text(record.title),
    authors: author,
    issued: date,
    container_title: text(record['container-title'], 1000),
    edition: text(record.edition, 120),
    volume: text(record.volume, 80),
    issue: text(record.issue, 80),
    item_pages: text(record.page, 120),
    publisher: text(record.publisher, 300),
    doi: doi ?? '',
    isbn: isbn ?? '',
    url: url ?? '',
    accessed: cslDate(record.accessed),
    repository_commit: text(record.version, 128),
    source_document_id: null,
    metadata_provenance: [],
    metadata_suggestions: [],
  });
  let duplicate: ImportedCitation['duplicate'] = null;
  for (const item of existing) {
    const reason = duplicateMatch(input, item);
    if (reason) {
      duplicate = { itemId: item.id, reason };
      break;
    }
  }
  return { input, source, warnings, duplicate };
}

function normalizedTitle(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseRis(input: string): CSL[] {
  const records: Record<string, string[]>[] = [];
  let current: Record<string, string[]> = {};
  let previousTag = '';
  const finish = () => {
    if (Object.keys(current).length) records.push(current);
    current = {};
    previousTag = '';
  };
  for (const line of input.split(/\r?\n/)) {
    const match = /^([A-Z0-9]{2}) {2}- (.*)$/.exec(line);
    if (!match) {
      if (/^\s+\S/.test(line) && previousTag) {
        const values = current[previousTag];
        if (values?.length) values[values.length - 1] = `${values.at(-1)} ${line.trim()}`;
      }
      continue;
    }
    const tag = match[1]!;
    const value = match[2]!.trim();
    if (tag === 'TY') {
      finish();
      current.TY = [value];
      previousTag = tag;
      continue;
    }
    if (tag === 'ER') {
      finish();
      continue;
    }
    (current[tag] ??= []).push(value.slice(0, 4096));
    previousTag = tag;
  }
  finish();
  if (!records.length || records.some((record) => !record.TY?.[0])) {
    throw new Error('RIS input must contain one or more records beginning with a TY tag.');
  }
  const typeMap: Record<string, CSL['type']> = {
    BOOK: 'book',
    CHAP: 'chapter',
    JOUR: 'article-journal',
    JFULL: 'article-journal',
    CPAPER: 'paper-conference',
    CONF: 'paper-conference',
    ELEC: 'webpage',
    WEB: 'webpage',
    BLOG: 'post-weblog',
    RPRT: 'report',
    THES: 'thesis',
    COMP: 'software',
    DATA: 'dataset',
  };
  return records.map((record, index) => {
    const values = (tag: string) => record[tag] ?? [];
    const first = (...tags: string[]) => tags.flatMap(values)[0] ?? '';
    const creators = [...values('AU'), ...values('A1')]
      .slice(0, 40)
      .map((name) => {
        const comma = name.indexOf(',');
        return comma >= 0
          ? { family: name.slice(0, comma).trim(), given: name.slice(comma + 1).trim() }
          : { literal: name.trim() };
      })
      .filter((author) => ('literal' in author ? author.literal : author.family || author.given));
    const rawDate = first('PY', 'Y1');
    const dateMatch = /^(\d{4})(?:[/-](\d{1,2})(?:[/-](\d{1,2}))?)?/.exec(rawDate);
    let issued: CSL['issued'];
    if (dateMatch) {
      const parts: [number] | [number, number] | [number, number, number] = dateMatch[3]
        ? [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])]
        : dateMatch[2]
          ? [Number(dateMatch[1]), Number(dateMatch[2])]
          : [Number(dateMatch[1])];
      issued = { 'date-parts': [parts] };
    } else if (rawDate) {
      issued = { literal: rawDate.slice(0, 120) };
    }
    const pages = first('SP') ? `${first('SP')}${first('EP') ? `-${first('EP')}` : ''}` : first('PG', 'SE');
    const type = first('TY').toUpperCase();
    const result: CSL = {
      id: `ris-${index + 1}`,
      type: typeMap[type] ?? 'document',
      title: first('TI', 'T1'),
      author: creators,
      publisher: first('PB'),
    };
    const container = first('T2', 'JF', 'JO', 'JA');
    const doi = first('DO', 'M3');
    const url = first('UR');
    const issue = first('IS');
    const volume = first('VL');
    const isbn = first('SN');
    if (issued) result.issued = issued;
    if (container) result['container-title'] = container;
    if (doi) result.DOI = doi;
    if (url) result.URL = url;
    if (issue) result.issue = issue;
    if (volume) result.volume = volume;
    if (pages) result.page = pages;
    if (isbn) result.ISBN = isbn;
    return result;
  });
}

function duplicateMatch(
  input: BibliographyItemInput,
  item: Pick<BibliographyItem, 'doi' | 'isbn' | 'title'>,
) {
  const doi = normalizeDoi(input.doi);
  const isbn = normalizeIsbn(input.isbn);
  if (doi && normalizeDoi(item.doi) === doi) return 'doi' as const;
  if (isbn && normalizeIsbn(item.isbn) === isbn) return 'isbn' as const;
  const title = normalizedTitle(input.title);
  if (title && normalizedTitle(item.title) === title) return 'title' as const;
  return null;
}

export function parseCitationImport(
  input: string,
  source: CitationImportFormat,
  existing: BibliographyItem[],
): ImportedCitation[] {
  const bytes = new TextEncoder().encode(input).byteLength;
  if (bytes === 0 || bytes > MAX_IMPORT_BYTES) throw new Error('Import must be between 1 byte and 256 KiB.');
  const forceType: Record<CitationImportFormat, string> = {
    bibtex: '@bibtex/text',
    ris: '@ris/text',
    csl_json: '@else/json',
  };
  let data: CSL[];
  try {
    if (source === 'ris') data = parseRis(input);
    else
      data = new Cite(input, {
        maxChainLength: 4,
        generateGraph: false,
        strict: true,
        forceType: forceType[source],
        target: '@csl/list+object',
      }).data;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('RIS input')) throw error;
    throw new Error(`Could not parse ${source.replace('_', ' ').toUpperCase()} input.`);
  }
  if (!Array.isArray(data) || data.length === 0) throw new Error('Import contains no bibliographic records.');
  if (data.length > MAX_IMPORT_RECORDS) throw new Error('Import is limited to 50 records at a time.');
  const rows = data.map((record) => importOne(record, source, existing));
  return rows.map((row, index) => {
    if (row.duplicate) return row;
    for (let prior = 0; prior < index; prior += 1) {
      const reason = duplicateMatch(row.input, rows[prior]!.input);
      if (reason) return { ...row, duplicate: { itemId: `batch:${prior}`, reason } };
    }
    return row;
  });
}

export function acceptedImportProvenance(input: BibliographyItemInput, source: CitationImportFormat) {
  const present = new Set<BibliographyField>();
  if (input.title) present.add('title');
  if (input.authors.length) present.add('authors');
  if (input.issued) present.add('issued');
  if (input.container_title) present.add('container_title');
  if (input.edition) present.add('edition');
  if (input.volume) present.add('volume');
  if (input.issue) present.add('issue');
  if (input.item_pages) present.add('item_pages');
  if (input.publisher) present.add('publisher');
  if (input.doi) present.add('doi');
  if (input.isbn) present.add('isbn');
  if (input.url) present.add('url');
  if (input.accessed) present.add('accessed');
  if (input.repository_commit) present.add('repository_commit');
  return [...present].map((field) => ({ field, source, confirmed: true as const }));
}

export const citationLimits = {
  maxImportBytes: MAX_IMPORT_BYTES,
  maxImportRecords: MAX_IMPORT_RECORDS,
} as const;
