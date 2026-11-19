import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GithubImportRequestSchema,
  NotebookCellSelectionSchema,
  NotebookFileSelectionSchema,
  TextFileSelectionSchema,
} from '../src/github-import-api';
import {
  EvidencePinSchema,
  GithubFileProvenanceSchema,
  GithubLocatorSchema,
  ResolvedEvidenceSchema,
  SourceSnapshotSchema,
  SourceVersionSchema,
} from '../src/source-version-api';

const models = { request: GithubImportRequestSchema, snapshot: SourceSnapshotSchema };
const fixture: {
  valid: Record<string, unknown>;
  invalid: { name: string; schema: keyof typeof models; input: unknown }[];
} = JSON.parse(readFileSync(new URL('../../../contracts/github-import-api.json', import.meta.url), 'utf8'));
const legacy: { valid: Record<string, unknown> } = JSON.parse(
  readFileSync(new URL('../../../contracts/source-version-api.json', import.meta.url), 'utf8'),
);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

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

describe('bounded public GitHub selection contracts', () => {
  it('parses Python-generated requests, notebook evidence and responses without wire drift', () => {
    for (const [name, model] of [
      ['request', GithubImportRequestSchema],
      ['request_with_defaults', GithubImportRequestSchema],
      ['version', SourceVersionSchema],
      ['pin', EvidencePinSchema],
      ['resolved', ResolvedEvidenceSchema],
    ] as const) {
      expect(model.parse(fixture.valid[name]), name).toEqual(fixture.valid[name]);
    }
    for (const invalid of fixture.invalid) {
      expect(models[invalid.schema].safeParse(invalid.input).success, invalid.name).toBe(false);
    }
  });

  it('preserves exact canonical hashes, Bengali text, file provenance and notebook source coordinates', () => {
    const version = SourceVersionSchema.parse(fixture.valid.version);
    expect(sha256(JSON.stringify(ordered(version.snapshot)))).toBe(version.content_hash);
    for (const segment of version.snapshot.segments) expect(sha256(segment.text)).toBe(segment.text_sha256);
    const pin = EvidencePinSchema.parse(fixture.valid.pin);
    expect(pin.locator.kind).toBe('github');
    if (pin.locator.kind !== 'github') throw new Error('Fixture must have a GitHub locator.');
    expect(pin.locator.notebook_cell).toEqual({ index: 0, cell_type: 'markdown' });
    expect(pin.locator.start_line).toBe(1);
    expect(pin.locator.end_line).toBe(2);
    expect(pin.quote).toContain('\u0986\u09b2\u09cb');
    const resolved = ResolvedEvidenceSchema.parse(fixture.valid.resolved);
    expect(resolved.canonical_url).toMatch(/\/lessons\/light\.ipynb$/);
    expect(resolved.canonical_url).not.toContain('#L');
    const files = version.snapshot.provenance.repository_files;
    expect(files?.map((file) => file.path)).toEqual(['docs/reading.md', 'lessons/light.ipynb']);
    expect(version.snapshot.provenance.rights.status).toBe('user_declared');
  });

  it('does not add new metadata to legacy F01 snapshots or alter their hashes', () => {
    for (const name of ['pdf_version', 'github_version']) {
      const version = SourceVersionSchema.parse(legacy.valid[name]);
      expect(JSON.parse(JSON.stringify(version))).toEqual(legacy.valid[name]);
      expect(sha256(JSON.stringify(ordered(version.snapshot)))).toBe(version.content_hash);
      expect(version.snapshot.provenance.repository_files).toBeUndefined();
    }
    const version = SourceVersionSchema.parse(legacy.valid.github_version);
    const data = {
      ...version,
      snapshot: {
        ...version.snapshot,
        provenance: { ...version.snapshot.provenance, repository_files: null },
        segments: version.snapshot.segments.map((segment) => ({
          ...segment,
          locator: { ...segment.locator, notebook_cell: null },
        })),
      },
    };
    expect(JSON.parse(JSON.stringify(SourceVersionSchema.parse(data)))).toEqual(legacy.valid.github_version);
  });

  it('keeps notebook cells explicit and source line indexes strict and bounded', () => {
    expect(TextFileSelectionSchema.parse({ kind: 'text', path: 'README.md' })).toEqual({
      kind: 'text',
      path: 'README.md',
      start_line: 1,
      end_line: null,
    });
    expect(NotebookCellSelectionSchema.parse({ index: 0 })).toEqual({
      index: 0,
      start_line: 1,
      end_line: null,
    });
    expect(
      NotebookFileSelectionSchema.safeParse({
        kind: 'notebook',
        path: 'lesson.IPYNB',
        cells: [{ index: 255, start_line: 2, end_line: 1001 }],
      }).success,
    ).toBe(true);
    for (const index of [true, false, -1, 1.2, '0', 256]) {
      expect(NotebookCellSelectionSchema.safeParse({ index }).success).toBe(false);
    }
    for (const end_line of [0, 1001, '1', true]) {
      expect(NotebookCellSelectionSchema.safeParse({ index: 0, end_line }).success).toBe(false);
    }
    expect(NotebookCellSelectionSchema.safeParse({ index: 0, start_line: 2, end_line: 1001 }).success).toBe(
      true,
    );
    expect(NotebookCellSelectionSchema.safeParse({ index: 0, start_line: 2, end_line: 1 }).success).toBe(
      false,
    );
    expect(
      NotebookFileSelectionSchema.safeParse({
        kind: 'notebook',
        path: 'lesson.ipynb',
        cells: [{ index: 0, outputs: ['must not import'] }],
      }).success,
    ).toBe(false);
  });

  it('validates file hashes and bytes independently from source line text', () => {
    const version = SourceVersionSchema.parse(fixture.valid.version);
    const file = version.snapshot.provenance.repository_files?.[0];
    if (!file) throw new Error('Fixture must have file provenance.');
    for (const byte_count of [true, '1', 0, 262145, 1.5]) {
      expect(GithubFileProvenanceSchema.safeParse({ ...file, byte_count }).success).toBe(false);
    }
    for (const git_blob_sha of ['main', 'a'.repeat(39), 'a'.repeat(40) + '\n']) {
      expect(GithubFileProvenanceSchema.safeParse({ ...file, git_blob_sha }).success).toBe(false);
    }
    expect(GithubFileProvenanceSchema.safeParse({ ...file, raw_sha256: 'b'.repeat(64) + '\n' }).success).toBe(
      false,
    );
    expect(GithubFileProvenanceSchema.safeParse({ ...file, path: '../unsafe' }).success).toBe(false);
    expect(
      GithubLocatorSchema.safeParse({
        kind: 'github',
        path: 'lesson.ipynb',
        start_line: 1,
        end_line: 1,
        notebook_cell: { index: 0, cell_type: 'code', execution_count: 1 },
      }).success,
    ).toBe(false);
  });

  it('requires a Unicode-safe nonblank permission statement without inventing publication rights', () => {
    const request = GithubImportRequestSchema.parse(fixture.valid.request);
    for (const rights_statement of [
      ' ',
      '\u0085',
      '\u001c\u001d\u001e\u001f',
      '\ud800',
      'Private\0study',
      'x'.repeat(1001),
    ]) {
      expect(
        GithubImportRequestSchema.safeParse({ ...request, rights_statement }).success,
        rights_statement,
      ).toBe(false);
    }
    for (const rights_statement of ['\ufeff', '\u0986'.repeat(1000), '\ud83c\udf31'.repeat(1000)]) {
      expect(GithubImportRequestSchema.safeParse({ ...request, rights_statement }).success).toBe(true);
    }
    expect(
      GithubImportRequestSchema.safeParse({ ...request, rights: { status: 'public_license' } }).success,
    ).toBe(false);
  });
});
