import { z } from 'zod';

/** Version-one source/evidence wire contracts (8.F01).
 * These synchronous browser schemas validate shape, locators and payload bounds.
 * SHA-256 verification, ownership and exact-quote checks are server-authoritative.
 * Receiving a syntactically valid hash never establishes source authenticity.
 */
export const MAX_SOURCE_SNAPSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_SEGMENTS = 2000;
export const MAX_SOURCE_SEGMENT_CHARS = 16000;

const Hash = z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/);
const Uuid = z.string().uuid().length(36);
function boundedUnicode(value: string, minimum: number, maximum: number): boolean {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    count += 1;
    if (count > maximum) return false;
  }
  return count >= minimum;
}
const WireString = z.string().refine((value) => boundedUnicode(value, 0, Infinity), {
  message: 'Text must be valid UTF-8 without NUL characters.',
});
// Pydantic string bounds count Unicode code points rather than UTF-16 units.
const boundedText = (minimum: number, maximum: number) =>
  z.string().refine((value) => boundedUnicode(value, minimum, maximum), {
    message: `Text must contain ${minimum} to ${maximum} valid Unicode code points without NUL characters.`,
  });
const Text = boundedText(1, 500);

export const PdfOriginSchema = z.strictObject({
  kind: z.literal('pdf').default('pdf'),
  document_id: Uuid,
  page_count: z.number().int().min(1).max(100000),
  book_title: Text.nullable().default(null),
  edition: Text.nullable().default(null),
});
export type PdfOrigin = z.infer<typeof PdfOriginSchema>;

export const GithubOriginSchema = z.strictObject({
  kind: z.literal('github').default('github'),
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$(?![\s\S])/),
  repository: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_.-]+$(?![\s\S])/)
    .refine((value) => value !== '.' && value !== '..', {
      message: 'Repository must name a GitHub repository.',
    }),
  commit: z.string().regex(/^[0-9a-f]{40}$(?![\s\S])/),
});
export type GithubOrigin = z.infer<typeof GithubOriginSchema>;

export const TextOriginSchema = z.strictObject({
  kind: z.literal('text').default('text'),
  format: z.enum(['notes', 'txt', 'html', 'epub']),
  line_count: z.number().int().min(1).max(2000),
});

export const PdfLocatorSchema = z.strictObject({
  kind: z.literal('pdf').default('pdf'),
  // ONE-based physical position in the PDF, independent from the printed label.
  pdf_page_index: z.number().int().min(1).max(100000),
  printed_page_label: boundedText(1, 80).nullable().default(null),
  chunk_id: Uuid,
  chapter_id: Uuid.nullable().default(null),
});
export type PdfLocator = z.infer<typeof PdfLocatorSchema>;

export const GithubPathSchema = boundedText(1, 500).refine(
  (path) =>
    path.split('/').every((part) => !['', '.', '..'].includes(part)) &&
    !/[\\%:#?]/.test(path) &&
    ![...path].some((char) => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127),
  { message: 'Repository paths must be safe relative paths.' },
);

export const NotebookCellLocatorSchema = z.strictObject({
  // Notebook cell index is ZERO-based; its start/end source lines remain ONE-based.
  index: z.number().int().min(0).max(255),
  cell_type: z.enum(['markdown', 'code']),
});
export type NotebookCellLocator = z.infer<typeof NotebookCellLocatorSchema>;

export const GithubLocatorSchema = z
  .strictObject({
    kind: z.literal('github').default('github'),
    path: GithubPathSchema,
    start_line: z.number().int().min(1).max(1000000),
    end_line: z.number().int().min(1).max(1000000),
    // Explicit null is accepted by Python but omitted from canonical wire output.
    notebook_cell: NotebookCellLocatorSchema.nullish().transform((value) => value ?? undefined),
  })
  .refine((value) => value.end_line >= value.start_line && value.end_line - value.start_line < 1000, {
    message: 'Repository locators require a bounded ordered line range.',
  });
export type GithubLocator = z.infer<typeof GithubLocatorSchema>;

export const TextLocatorSchema = z
  .strictObject({
    kind: z.literal('text').default('text'),
    start_line: z.number().int().min(1).max(2000),
    end_line: z.number().int().min(1).max(2000),
  })
  .refine(({ start_line, end_line }) => end_line >= start_line, {
    message: 'Text lines must be ordered.',
  });

export const SourceLocatorSchema = z.discriminatedUnion('kind', [
  PdfLocatorSchema,
  GithubLocatorSchema,
  TextLocatorSchema,
]);
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;
export const SourceOriginSchema = z.discriminatedUnion('kind', [
  PdfOriginSchema,
  GithubOriginSchema,
  TextOriginSchema,
]);
export type SourceOrigin = z.infer<typeof SourceOriginSchema>;

export const SourceRightsSchema = z
  .strictObject({
    status: z.enum(['unknown', 'user_declared', 'public_license']).default('unknown'),
    statement: boundedText(1, 1000).nullable().default(null),
  })
  .refine((value) => (value.status === 'unknown') === (value.statement === null), {
    message: 'Known rights require a statement; unknown rights cannot imply a declaration.',
  });
export type SourceRights = z.infer<typeof SourceRightsSchema>;

export const GithubFileProvenanceSchema = z.strictObject({
  path: GithubPathSchema,
  git_blob_sha: z.string().regex(/^[0-9a-f]{40}$(?![\s\S])/),
  raw_sha256: Hash,
  byte_count: z.number().int().min(1).max(262144),
});
export type GithubFileProvenance = z.infer<typeof GithubFileProvenanceSchema>;

export const SourceProvenanceSchema = z
  .strictObject({
    adapter: z.enum(['legacy_pdf_chunks', 'github_selected_text', 'local_utf8_text']),
    parser_name: boundedText(1, 120).nullable().default(null),
    parser_version: boundedText(1, 120).nullable().default(null),
    original_sha256: Hash.nullable().default(null),
    rights: SourceRightsSchema.default({ status: 'unknown', statement: null }),
    repository_files: z
      .array(GithubFileProvenanceSchema)
      .min(1)
      .max(16)
      .nullish()
      .transform((value) => value ?? undefined),
    extraction_notes: z
      .array(Text)
      .min(1)
      .max(8)
      .nullish()
      .transform((value) => value ?? undefined),
  })
  .superRefine((value, context) => {
    if ((value.parser_name === null) !== (value.parser_version === null)) {
      context.addIssue({
        code: 'custom',
        message: 'Parser name and version must both be recorded or both unknown.',
      });
    }
    if (
      value.adapter === 'legacy_pdf_chunks' &&
      (value.parser_name !== null || value.original_sha256 !== null || value.repository_files !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Legacy extraction cannot attest a parser or original-file hash.',
      });
    }
    if (
      value.adapter === 'local_utf8_text' &&
      (value.parser_name !== 'studyvault-local-text' ||
        value.parser_version !== '1' ||
        value.original_sha256 === null ||
        value.repository_files !== undefined ||
        value.rights.status !== 'user_declared' ||
        !value.rights.statement?.trim())
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Local text requires extraction provenance and a rights declaration.',
      });
    }
    if (value.adapter !== 'local_utf8_text' && value.extraction_notes !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Extraction notes are reserved for local source adapters.',
      });
    }
  });
export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;

/** Python str.splitlines() semantics, including CRLF and Unicode boundaries. */
const LineBoundaries = new Set([10, 11, 12, 13, 28, 29, 30, 133, 8232, 8233]);
function lineCount(text: string): number {
  let count = 0;
  let atBoundary = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    atBoundary = LineBoundaries.has(code);
    if (atBoundary) {
      count += 1;
      if (code === 13 && text.charCodeAt(index + 1) === 10) index += 1;
    }
  }
  return count + (text.length > 0 && !atBoundary ? 1 : 0);
}

export const SourceSegmentSchema = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_.:-]+$(?![\s\S])/),
    locator: SourceLocatorSchema,
    text: boundedText(1, MAX_SOURCE_SEGMENT_CHARS),
    text_sha256: Hash,
  })
  .refine(
    (value) =>
      value.locator.kind === 'pdf' ||
      lineCount(value.text) === value.locator.end_line - value.locator.start_line + 1,
    { message: 'Repository text must contain exactly the selected lines.' },
  );
export type SourceSegment = z.infer<typeof SourceSegmentSchema>;

export const SourceSnapshotSchema = z
  .strictObject({
    schema_version: z.literal(1).default(1),
    title: Text,
    origin: SourceOriginSchema,
    provenance: SourceProvenanceSchema,
    segments: z.array(SourceSegmentSchema).min(1).max(MAX_SOURCE_SEGMENTS),
  })
  .superRefine((value, context) => {
    if (new Set(value.segments.map((segment) => segment.id)).size !== value.segments.length) {
      context.addIssue({
        code: 'custom',
        path: ['segments'],
        message: 'Segment identifiers must be unique.',
      });
    }
    const adapters = { pdf: 'legacy_pdf_chunks', github: 'github_selected_text', text: 'local_utf8_text' };
    if (value.provenance.adapter !== adapters[value.origin.kind]) {
      context.addIssue({
        code: 'custom',
        path: ['provenance'],
        message: 'Adapter does not match the source kind.',
      });
    }
    let nextTextLine = 1;
    value.segments.forEach((segment, index) => {
      if (segment.locator.kind !== value.origin.kind) {
        context.addIssue({
          code: 'custom',
          path: ['segments', index, 'locator'],
          message: 'Locator kind differs from the source kind.',
        });
      }
      if (value.origin.kind === 'pdf' && segment.locator.kind === 'pdf') {
        if (segment.locator.pdf_page_index > value.origin.page_count) {
          context.addIssue({
            code: 'custom',
            path: ['segments', index, 'locator'],
            message: 'PDF position is outside the source.',
          });
        }
        if (segment.id !== segment.locator.chunk_id) {
          context.addIssue({
            code: 'custom',
            path: ['segments', index, 'id'],
            message: 'PDF segments must retain the chunk identifier.',
          });
        }
      }
      if (segment.locator.kind === 'text') {
        const { start_line: start, end_line: end } = segment.locator;
        if (start !== nextTextLine || segment.id !== `text:L${start}-L${end}`) {
          context.addIssue({
            code: 'custom',
            path: ['segments', index],
            message: 'Text segments must use consecutive line ranges and stable identifiers.',
          });
        }
        nextTextLine = end + 1;
      }
    });
    if (value.origin.kind === 'text' && value.origin.line_count !== nextTextLine - 1) {
      context.addIssue({
        code: 'custom',
        path: ['origin', 'line_count'],
        message: 'Text segments must cover the declared lines.',
      });
    }
    if (
      value.origin.kind === 'text' &&
      ['html', 'epub'].includes(value.origin.format) !== (value.provenance.extraction_notes !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provenance'],
        message: 'Markup-derived line locators require extraction notes.',
      });
    }
    if (value.provenance.repository_files !== undefined) {
      const paths = value.provenance.repository_files.map((file) => file.path);
      if (
        new Set(paths).size !== paths.length ||
        value.segments.some(
          (segment) => segment.locator.kind !== 'github' || !paths.includes(segment.locator.path),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['provenance', 'repository_files'],
          message: 'Repository file provenance must uniquely cover each selected path.',
        });
      }
    }
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_SOURCE_SNAPSHOT_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Source snapshot exceeds the 2 MiB UTF-8 contract limit.',
      });
    }
  });
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

export const SourceVersionSchema = z.strictObject({
  id: Uuid,
  content_hash: Hash,
  snapshot: SourceSnapshotSchema,
  created_at: WireString,
});
export type SourceVersion = z.infer<typeof SourceVersionSchema>;

export const PdfSnapshotRequestSchema = z.strictObject({
  book_title: Text.nullable().default(null),
  edition: Text.nullable().default(null),
  printed_page_labels: z
    .record(z.string().regex(/^[1-9][0-9]{0,5}$(?![\s\S])/), boundedText(1, 80))
    .refine((value) => Object.keys(value).length <= 2000, {
      message: 'At most 2000 printed labels are allowed.',
    })
    .default({}),
  rights_statement: boundedText(1, 1000).nullable().default(null),
});
export type PdfSnapshotRequest = z.infer<typeof PdfSnapshotRequestSchema>;

export const EvidencePinSchema = z.strictObject({
  version_id: Uuid,
  content_hash: Hash,
  segment_id: boundedText(1, 120),
  locator: SourceLocatorSchema,
  quote: boundedText(1, 4000),
});
export type EvidencePin = z.infer<typeof EvidencePinSchema>;

export const ResolvedEvidenceSchema = z.strictObject({
  pin: EvidencePinSchema,
  source_title: Text,
  content: boundedText(1, MAX_SOURCE_SEGMENT_CHARS),
  canonical_url: WireString.nullable(),
  source_version_url: WireString,
});
export type ResolvedEvidence = z.infer<typeof ResolvedEvidenceSchema>;

const LocalTextMetadata = {
  title: boundedText(1, 200).refine((value) => !!value.trim()),
  rights_statement: boundedText(1, 1000).refine((value) => !!value.trim()),
};

const localFileBody = {
  ...LocalTextMetadata,
  filename: boundedText(5, 200),
  content_base64: z
    .string()
    .min(4)
    .max(Math.ceil((128 * 1024) / 3) * 4),
};

export const LocalTextImportSchema = z.discriminatedUnion('format', [
  z.strictObject({
    ...LocalTextMetadata,
    format: z.literal('notes'),
    text: boundedText(1, 128 * 1024),
  }),
  z.strictObject({
    ...localFileBody,
    format: z.literal('txt'),
    media_type: z.literal('text/plain'),
  }),
  z.strictObject({
    ...localFileBody,
    format: z.literal('html'),
    media_type: z.literal('text/html'),
  }),
  z.strictObject({
    ...localFileBody,
    format: z.literal('epub'),
    media_type: z.literal('application/epub+zip'),
  }),
]);
export type LocalTextImport = z.infer<typeof LocalTextImportSchema>;
