import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EvidenceSchema, MaterialEvidenceSchema } from '../src/course-api';
import {
  EvidencePinSchema,
  GithubLocatorSchema,
  GithubOriginSchema,
  LocalTextImportSchema,
  PdfSnapshotRequestSchema,
  ResolvedEvidenceSchema,
  SourceProvenanceSchema,
  SourceRightsSchema,
  SourceSegmentSchema,
  SourceSnapshotSchema,
  SourceVersionSchema,
} from '../src/source-version-api';

const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const chunkId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const versionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const chapterId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const text = 'Printed book evidence supports this claim.';
const locator = {
  kind: 'pdf' as const,
  pdf_page_index: 8,
  printed_page_label: 'iv',
  chunk_id: chunkId,
  chapter_id: chapterId,
};
const pdfSnapshot = () => ({
  schema_version: 1 as const,
  title: 'Evidence book',
  origin: {
    kind: 'pdf' as const,
    document_id: documentId,
    page_count: 16,
    book_title: 'Evidence book',
    edition: '2nd',
  },
  provenance: {
    adapter: 'legacy_pdf_chunks' as const,
    parser_name: null,
    parser_version: null,
    original_sha256: null,
    rights: { status: 'user_declared' as const, statement: 'Private permitted study copy.' },
  },
  segments: [{ id: chunkId, locator: { ...locator }, text, text_sha256: sha256(text) }],
});
const pin = () => ({
  version_id: versionId,
  content_hash: sha256('server-calculated-canonical-snapshot'),
  segment_id: chunkId,
  locator: { ...locator },
  quote: 'supports this claim',
});
const repoOrigin = {
  kind: 'github' as const,
  owner: 'Study-Vault',
  repository: 'course.docs',
  commit: 'a'.repeat(40),
};
const repoLocator = { kind: 'github' as const, path: 'docs/reading guide.md', start_line: 12, end_line: 13 };
const repoSegment = (content = 'First line.\nSecond line.\n') => ({
  id: 'reading:12',
  locator: { ...repoLocator },
  text: content,
  text_sha256: sha256(content),
});
const repoSnapshot = () => ({
  schema_version: 1 as const,
  title: 'Pinned public course',
  origin: { ...repoOrigin },
  provenance: { adapter: 'github_selected_text' as const, parser_name: 'text-lines', parser_version: '1' },
  segments: [repoSegment()],
});

describe('local UTF-8 source snapshots', () => {
  it('preserves a contiguous local line locator and requires declared rights', () => {
    const content = 'Read this\n    indented example\n';
    const snapshot = {
      schema_version: 1,
      title: 'Lecture notes',
      origin: { kind: 'text', format: 'notes', line_count: 2 },
      provenance: {
        adapter: 'local_utf8_text',
        parser_name: 'studyvault-local-text',
        parser_version: '1',
        original_sha256: sha256(content),
        rights: { status: 'user_declared', statement: 'I authored this.' },
      },
      segments: [
        {
          id: 'text:L1-L2',
          locator: { kind: 'text', start_line: 1, end_line: 2 },
          text: content,
          text_sha256: sha256(content),
        },
      ],
    };
    expect(SourceSnapshotSchema.parse(snapshot).segments[0]?.text).toBe(content);
    expect(
      SourceSnapshotSchema.safeParse({ ...snapshot, origin: { ...snapshot.origin, line_count: 3 } }).success,
    ).toBe(false);
    expect(
      SourceSnapshotSchema.safeParse({
        ...snapshot,
        provenance: { ...snapshot.provenance, rights: { status: 'unknown' } },
      }).success,
    ).toBe(false);
    const markup = { ...snapshot, origin: { ...snapshot.origin, format: 'epub' } };
    expect(SourceSnapshotSchema.safeParse(markup).success).toBe(false);
    expect(
      SourceSnapshotSchema.safeParse({
        ...markup,
        provenance: { ...markup.provenance, extraction_notes: ['Extracted text line references.'] },
      }).success,
    ).toBe(true);
    expect(
      LocalTextImportSchema.safeParse({
        format: 'notes',
        title: 'Lecture notes',
        rights_statement: 'I authored this.',
        text: content,
      }).success,
    ).toBe(true);
    expect(
      LocalTextImportSchema.safeParse({
        format: 'txt',
        title: 'Lecture notes',
        rights_statement: 'I authored this.',
        filename: 'image.pdf',
        media_type: 'application/pdf',
        content_base64: 'aGV5',
      }).success,
    ).toBe(false);
  });
});

const fixtureModels = {
  source_snapshot: SourceSnapshotSchema,
  evidence_pin: EvidencePinSchema,
  pdf_snapshot_request: PdfSnapshotRequestSchema,
};
const sharedFixture: {
  valid: Record<string, unknown>;
  invalid: { name: string; schema: keyof typeof fixtureModels; input: unknown }[];
} = JSON.parse(readFileSync(new URL('../../../contracts/source-version-api.json', import.meta.url), 'utf8'));

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, ordered(child)]),
    );
  }
  return value;
}

describe('immutable source and evidence wire contracts', () => {
  it('parses every Python-generated wire fixture without changing its fields', () => {
    for (const [name, schema] of [
      ['pdf_snapshot_request', PdfSnapshotRequestSchema],
      ['pdf_version', SourceVersionSchema],
      ['github_version', SourceVersionSchema],
      ['pdf_pin', EvidencePinSchema],
      ['github_pin', EvidencePinSchema],
      ['pdf_resolved', ResolvedEvidenceSchema],
      ['github_resolved', ResolvedEvidenceSchema],
    ] as const) {
      expect(schema.parse(sharedFixture.valid[name]), name).toEqual(sharedFixture.valid[name]);
    }
    for (const item of sharedFixture.invalid) {
      expect(fixtureModels[item.schema].safeParse(item.input).success, item.name).toBe(false);
    }
  });

  it('matches Python canonical UTF-8 snapshot and text hashes in reviewed fixtures', () => {
    for (const kind of ['pdf', 'github']) {
      const version = SourceVersionSchema.parse(sharedFixture.valid[`${kind}_version`]);
      expect(sha256(JSON.stringify(ordered(version.snapshot)))).toBe(version.content_hash);
      for (const segment of version.snapshot.segments) expect(sha256(segment.text)).toBe(segment.text_sha256);
    }
    const pdf = SourceVersionSchema.parse(sharedFixture.valid.pdf_version);
    expect(pdf.snapshot.segments[0]!.text).toContain('\u0986\u09b2\u09cb');
  });

  it('keeps book edition, printed label and one-based physical PDF position distinct', () => {
    expect(SourceSnapshotSchema.parse(pdfSnapshot())).toEqual(pdfSnapshot());
    const parsedPin = EvidencePinSchema.parse(pin());
    expect(parsedPin.locator).toEqual(locator);
    expect(
      ResolvedEvidenceSchema.parse({
        pin: parsedPin,
        source_title: 'Evidence book',
        content: text,
        canonical_url: null,
        source_version_url: `/api/source-versions/${versionId}`,
      }).pin,
    ).toEqual(parsedPin);
    expect(
      SourceVersionSchema.safeParse({
        id: versionId,
        content_hash: sha256('server snapshot'),
        snapshot: pdfSnapshot(),
        created_at: '2026-11-19T00:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown properties, missing identity, duplicate IDs and wrong PDF positions', () => {
    expect(SourceSnapshotSchema.safeParse({ ...pdfSnapshot(), owner: 'injected' }).success).toBe(false);
    expect(EvidencePinSchema.safeParse({ ...pin(), version_id: undefined }).success).toBe(false);
    const duplicate = pdfSnapshot();
    duplicate.segments.push(duplicate.segments[0]!);
    expect(SourceSnapshotSchema.safeParse(duplicate).success).toBe(false);
    const wrongPage = pdfSnapshot();
    wrongPage.segments[0]!.locator.pdf_page_index = 17;
    expect(SourceSnapshotSchema.safeParse(wrongPage).success).toBe(false);
    for (const page of [0, -1, 1.5, '8', true]) {
      const invalid = { ...pin(), locator: { ...locator, pdf_page_index: page } };
      expect(EvidencePinSchema.safeParse(invalid).success).toBe(false);
    }
    const wrongChunk = pdfSnapshot();
    wrongChunk.segments[0]!.id = 'mismatched';
    expect(SourceSnapshotSchema.safeParse(wrongChunk).success).toBe(false);
  });

  it('retains explicit unknown historic provenance instead of inventing parser or file hashes', () => {
    expect(SourceProvenanceSchema.parse({ adapter: 'legacy_pdf_chunks' })).toEqual({
      adapter: 'legacy_pdf_chunks',
      parser_name: null,
      parser_version: null,
      original_sha256: null,
      rights: { status: 'unknown', statement: null },
    });
    expect(
      SourceProvenanceSchema.safeParse({
        adapter: 'legacy_pdf_chunks',
        parser_name: 'pdfplumber',
        parser_version: 'new',
      }).success,
    ).toBe(false);
    expect(
      SourceProvenanceSchema.safeParse({ adapter: 'legacy_pdf_chunks', original_sha256: 'a'.repeat(64) })
        .success,
    ).toBe(false);
    expect(
      SourceProvenanceSchema.safeParse({ adapter: 'github_selected_text', parser_name: 'text' }).success,
    ).toBe(false);
    expect(SourceRightsSchema.safeParse({ status: 'public_license' }).success).toBe(false);
    expect(SourceRightsSchema.safeParse({ status: 'unknown', statement: 'MIT' }).success).toBe(false);
    expect(SourceRightsSchema.parse({ status: 'public_license', statement: 'MIT' }).statement).toBe('MIT');
  });

  it('requires full pinned commits and safe relative repository paths', () => {
    expect(SourceSnapshotSchema.safeParse(repoSnapshot()).success).toBe(true);
    for (const commit of ['main', 'a'.repeat(7), 'A'.repeat(40), 'a'.repeat(41)]) {
      expect(GithubOriginSchema.safeParse({ ...repoOrigin, commit }).success).toBe(false);
    }
    for (const repository of ['.', '..', 'bad/repo', 'repository?token=x']) {
      expect(GithubOriginSchema.safeParse({ ...repoOrigin, repository }).success).toBe(false);
    }
    for (const path of [
      '/absolute',
      '../parent',
      'docs/../secret',
      'docs//file',
      'docs/./file',
      'C:\\secret',
      'docs\\file',
      '%2e%2e/file',
      'docs/a#L1',
      'https://evil.test/file',
      'a\u0000b',
      'a\u007fb',
    ]) {
      expect(GithubLocatorSchema.safeParse({ ...repoLocator, path }).success, path).toBe(false);
    }
    expect(GithubLocatorSchema.safeParse({ ...repoLocator, end_line: 11 }).success).toBe(false);
    expect(GithubLocatorSchema.safeParse({ ...repoLocator, end_line: 1012 }).success).toBe(false);
    expect(GithubLocatorSchema.safeParse({ ...repoLocator, start_line: '12' }).success).toBe(false);
  });

  it('verifies repository line count including CRLF, final newline and Unicode splitlines', () => {
    for (const content of [
      'First\nSecond',
      'First\nSecond\n',
      'First\r\nSecond\r\n',
      'First\u2028Second\u2029',
    ]) {
      expect(SourceSegmentSchema.safeParse(repoSegment(content)).success, JSON.stringify(content)).toBe(true);
    }
    for (const content of ['Only one line', 'First\nSecond\nThird', 'First\n\nSecond']) {
      expect(SourceSegmentSchema.safeParse(repoSegment(content)).success).toBe(false);
    }
    expect(SourceSegmentSchema.safeParse({ ...repoSegment(), text_sha256: 'bad' }).success).toBe(false);
    const mixedKinds = { ...repoSnapshot(), segments: pdfSnapshot().segments };
    expect(SourceSnapshotSchema.safeParse(mixedKinds).success).toBe(false);
    expect(
      SourceSnapshotSchema.safeParse({ ...repoSnapshot(), provenance: pdfSnapshot().provenance }).success,
    ).toBe(false);
  });

  it('bounds segment count, Unicode characters, UTF-8 bytes and request labels', () => {
    const oneLine = 'গ'.repeat(16000);
    const largeSegment = {
      id: '0',
      locator: { ...repoLocator, start_line: 1, end_line: 1 },
      text: oneLine,
      text_sha256: sha256(oneLine),
    };
    const segments = Array.from({ length: 50 }, (_, index) => ({ ...largeSegment, id: String(index) }));
    expect(SourceSnapshotSchema.safeParse({ ...repoSnapshot(), segments }).success).toBe(false);
    expect(
      SourceSnapshotSchema.safeParse({ ...repoSnapshot(), segments: segments.slice(0, 40) }).success,
    ).toBe(true);
    expect(
      SourceSnapshotSchema.safeParse({
        ...repoSnapshot(),
        segments: Array.from({ length: 2001 }, (_, index) => ({ ...repoSegment(), id: String(index) })),
      }).success,
    ).toBe(false);
    expect(SourceSegmentSchema.safeParse({ ...largeSegment, text: 'x'.repeat(16001) }).success).toBe(false);
    expect(SourceSnapshotSchema.safeParse({ ...pdfSnapshot(), title: '😀'.repeat(500) }).success).toBe(true);
    expect(SourceSnapshotSchema.safeParse({ ...pdfSnapshot(), title: '😀'.repeat(501) }).success).toBe(false);
    expect(PdfSnapshotRequestSchema.parse({})).toEqual({
      book_title: null,
      edition: null,
      printed_page_labels: {},
      rights_statement: null,
    });
    expect(
      PdfSnapshotRequestSchema.parse({ printed_page_labels: { '8': 'iv' } }).printed_page_labels['8'],
    ).toBe('iv');
    for (const key of ['0', '01', '-1', '1.5', 'iv', '1000000']) {
      expect(PdfSnapshotRequestSchema.safeParse({ printed_page_labels: { [key]: 'label' } }).success).toBe(
        false,
      );
    }
    expect(
      PdfSnapshotRequestSchema.safeParse({
        printed_page_labels: Object.fromEntries(
          Array.from({ length: 2001 }, (_, index) => [String(index + 1), 'label']),
        ),
      }).success,
    ).toBe(false);
    expect(EvidencePinSchema.safeParse({ ...pin(), quote: 'q'.repeat(4001) }).success).toBe(false);
  }, 30000);

  it('preserves legacy course evidence shape and validates optional pins without rewriting quotes', () => {
    const oldEvidence = { id: 'evidence', source_id: 'source', locator: 'Printed iv', quote: pin().quote };
    expect(EvidenceSchema.parse(oldEvidence)).toEqual(oldEvidence);
    expect(EvidenceSchema.parse({ ...oldEvidence, source_pin: pin() }).source_pin).toEqual(pin());
    expect(
      EvidenceSchema.safeParse({ ...oldEvidence, source_pin: { ...pin(), quote: 'different' } }).success,
    ).toBe(false);
    expect(
      MaterialEvidenceSchema.parse({
        ...oldEvidence,
        source_pin: pin(),
        document_id: documentId,
        chapter_id: chapterId,
        chunk_id: chunkId,
      }).source_pin,
    ).toEqual(pin());
  });
});
