import { z } from 'zod';
import { GithubOriginSchema, GithubPathSchema } from './source-version-api';

/** Explicit anonymous public-source selection. No URL, token, credentials or code execution fields. */
export const LineSelectionSchema = z
  .strictObject({
    start_line: z.number().int().min(1).max(1000000).default(1),
    end_line: z.number().int().min(1).max(1000000).nullable().default(null),
  })
  .refine(
    (value) =>
      value.end_line === null ||
      (value.end_line >= value.start_line && value.end_line - value.start_line < 1000),
    { message: 'Select at most 1000 ordered source lines.' },
  );
export type LineSelection = z.infer<typeof LineSelectionSchema>;

export const NotebookCellSelectionSchema = LineSelectionSchema.safeExtend({
  index: z.number().int().min(0).max(255),
});
export type NotebookCellSelection = z.infer<typeof NotebookCellSelectionSchema>;

export const TextFileSelectionSchema = LineSelectionSchema.safeExtend({
  kind: z.literal('text'),
  path: GithubPathSchema.refine((value) => !value.toLowerCase().endsWith('.ipynb'), {
    message: 'Notebooks require explicit cell selections.',
  }),
});
export type TextFileSelection = z.infer<typeof TextFileSelectionSchema>;

export const NotebookFileSelectionSchema = z
  .strictObject({
    kind: z.literal('notebook'),
    path: GithubPathSchema.refine((value) => value.toLowerCase().endsWith('.ipynb'), {
      message: 'Notebook selections require an .ipynb file.',
    }),
    cells: z.array(NotebookCellSelectionSchema).min(1).max(8),
  })
  .refine((value) => new Set(value.cells.map((cell) => cell.index)).size === value.cells.length, {
    message: 'Notebook cell indexes must be unique.',
  });
export type NotebookFileSelection = z.infer<typeof NotebookFileSelectionSchema>;

export const GithubFileSelectionSchema = z.discriminatedUnion('kind', [
  TextFileSelectionSchema,
  NotebookFileSelectionSchema,
]);
export type GithubFileSelection = z.infer<typeof GithubFileSelectionSchema>;

// Match Python str.strip(), including its additional C0/NEL whitespace values.
const PythonWhitespace = new Set([
  9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200,
  8201, 8202, 8232, 8233, 8239, 8287, 12288,
]);
const RightsStatement = z.string().refine(
  (value) => {
    let length = 0;
    let hasNonWhitespace = false;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 0) return false;
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) return false;
      if (!PythonWhitespace.has(code)) hasNonWhitespace = true;
      length += 1;
      if (length > 1000) return false;
    }
    return length > 0 && hasNonWhitespace;
  },
  {
    message:
      'Confirm permission with 1 to 1000 valid Unicode code points for the intended private study use.',
  },
);

export const GithubImportRequestSchema = z
  .strictObject({
    origin: GithubOriginSchema,
    files: z.array(GithubFileSelectionSchema).min(1).max(16),
    rights_statement: RightsStatement,
  })
  .refine((value) => new Set(value.files.map((file) => file.path)).size === value.files.length, {
    message: 'Selected file paths must be unique.',
  });
export type GithubImportRequest = z.infer<typeof GithubImportRequestSchema>;
