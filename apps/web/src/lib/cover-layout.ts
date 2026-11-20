import {
  AcademicCoverDraftSchema,
  AcademicCoverTemplateSchema,
  type AcademicCoverTemplate,
  type CoverFieldKey,
  type CoverFontFamily,
  type CoverPageSize,
  type CoverTemplateId,
} from '@studyvault/types';
import { COVER_PALETTES, coverDecorations, type CoverDecoration } from './cover-decoration';

export const COVER_PAPER = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const satisfies Record<CoverPageSize, { width: number; height: number }>;

const fieldOrder = [
  'institutionName',
  'department',
  'assignmentNumber',
  'title',
  'subtitle',
  'courseCode',
  'courseName',
  'groupName',
  'students',
  'instructorName',
  'date',
] as const satisfies readonly CoverFieldKey[];

function template(
  id: CoverTemplateId,
  label: string,
  fontFamily: CoverFontFamily,
  alignment: 'left' | 'center',
  margin: number,
  top: number,
  titleSize: number,
  titleGap: number,
) {
  const fields = fieldOrder.map((field) => ({
    field,
    alignment,
    fontFamily,
    fontSize: field === 'title' ? titleSize : field === 'institutionName' ? 18 : 13,
    minFontSize: field === 'title' ? 18 : 10,
    maxLines: field === 'students' ? 80 : field === 'title' ? 7 : 4,
    gapBefore: field === 'title' ? titleGap : field === 'students' ? 12 : 5,
    bold: field === 'title' || field === 'institutionName' || field === 'groupName',
  }));
  return AcademicCoverTemplateSchema.parse({
    id,
    label,
    version: 1,
    pageSizes: ['a4', 'letter'],
    fields,
    margins: { top, left: margin, bottom: margin, right: margin },
  });
}

export const COVER_TEMPLATES = {
  'university-assignment': template(
    'university-assignment',
    'University assignment',
    'times-roman',
    'center',
    64,
    80,
    36,
    36,
  ),
  'lab-report': template('lab-report', 'Lab report', 'courier', 'left', 54, 64, 30, 22),
  'project-report': template('project-report', 'Project report', 'helvetica', 'center', 76, 88, 40, 44),
  'minimal-professional': template(
    'minimal-professional',
    'Minimal professional',
    'helvetica',
    'left',
    58,
    92,
    34,
    18,
  ),
} satisfies Record<CoverTemplateId, AcademicCoverTemplate>;

export type CoverMeasure = (
  text: string,
  fontFamily: CoverFontFamily,
  fontSize: number,
  bold: boolean,
) => number;

type CoverLine = {
  field: CoverFieldKey;
  text: string;
  x: number;
  y: number;
  width: number;
  fontFamily: CoverFontFamily;
  fontSize: number;
  bold: boolean;
  color: string;
};
type CoverBox = { x: number; y: number; width: number; height: number };
type CoverContentLayout = {
  width: number;
  height: number;
  lines: CoverLine[];
  overflow: boolean;
  logo?: CoverBox;
};
type CoverLayout = CoverContentLayout & { decorations: CoverDecoration[] };

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function wrapLine(value: string, width: number, measure: (line: string) => number) {
  const lines: string[] = [];
  let current = '';
  for (const word of value.trim().split(/\s+/u)) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = '';
    if (measure(word) <= width) {
      current = word;
      continue;
    }
    for (const { segment } of graphemes.segment(word)) {
      if (current && measure(current + segment) > width) {
        lines.push(current);
        current = '';
      }
      current += segment;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Layout one page in points, with a top origin and text drawn at its baseline. */
export function layoutCover(
  input: unknown,
  measure: CoverMeasure,
  options: {
    logo?: { width: number; height: number };
    template?: AcademicCoverTemplate;
  } = {},
): CoverLayout {
  const draft = AcademicCoverDraftSchema.parse(input);
  const design = options.template
    ? AcademicCoverTemplateSchema.parse(options.template)
    : COVER_TEMPLATES[draft.templateId];
  if (
    design.id !== draft.templateId ||
    design.version !== draft.templateVersion ||
    !design.pageSizes.includes(draft.pageSize)
  ) {
    throw new Error('The template does not support this cover draft.');
  }
  const { width, height } = COVER_PAPER[draft.pageSize];
  const palette = COVER_PALETTES[design.id];
  const { top, right, bottom, left } = design.margins;
  const availableWidth = width - right - left;
  const content = draft.content;
  const values: Record<CoverFieldKey, string[]> = {
    ...(Object.fromEntries(
      fieldOrder.filter((field) => field !== 'students').map((field) => [field, [content[field]]]),
    ) as Record<Exclude<CoverFieldKey, 'students'>, string[]>),
    students: content.students.map(({ name, id, section }) =>
      [name, id && `ID: ${id}`, section && `Section: ${section}`].filter(Boolean).join(' · '),
    ),
  };
  const start = options.logo;
  let logo: CoverBox | undefined;
  if (start) {
    if (
      !Number.isFinite(start.width) ||
      !Number.isFinite(start.height) ||
      start.width <= 0 ||
      start.height <= 0
    ) {
      throw new Error('Invalid logo dimensions.');
    }
    const scale = Math.min(128 / start.width, 82 / start.height);
    const logoWidth = start.width * scale;
    logo = {
      x: design.fields[0]?.alignment === 'left' ? left : left + (availableWidth - logoWidth) / 2,
      y: top,
      width: logoWidth,
      height: start.height * scale,
    };
  }

  function arrange(shrink: number): CoverContentLayout {
    const lines: CoverLine[] = [];
    let cursor = logo ? top + logo.height + 12 : top;
    for (const rule of design.fields) {
      const entries = values[rule.field].flatMap((value) => value.split(/\r\n?|\n/u));
      if (entries.every((entry) => !entry.trim())) continue;
      const { field, fontFamily, bold, alignment } = rule;
      const fontSize = Math.max(rule.minFontSize, rule.fontSize - shrink);
      const measureLine = (line: string) => measure(line, fontFamily, fontSize, bold);
      const wrapped = entries.flatMap((entry) => wrapLine(entry, availableWidth, measureLine));
      cursor += lines.length ? rule.gapBefore : 0;
      for (const [index, value] of wrapped.entries()) {
        const lineWidth = measureLine(value);
        const advance = fontSize * 1.28;
        if (
          index >= rule.maxLines ||
          !Number.isFinite(lineWidth) ||
          lineWidth < 0 ||
          lineWidth > availableWidth ||
          cursor + advance > height - bottom
        ) {
          return { width, height, lines, overflow: true, logo };
        }
        const offset = availableWidth - lineWidth;
        const x = left + (alignment === 'right' ? offset : alignment === 'center' ? offset / 2 : 0);
        lines.push({
          field,
          text: value,
          x,
          y: cursor + fontSize,
          width: lineWidth,
          fontFamily,
          fontSize,
          bold,
          color: field === 'title' || field === 'institutionName' ? palette.heading : palette.ink,
        });
        cursor += advance;
      }
    }
    return { width, height, lines, overflow: false, logo };
  }

  const maxShrink = Math.max(...design.fields.map((rule) => rule.fontSize - rule.minFontSize));
  let result = arrange(0);
  for (let shrink = 1; result.overflow && shrink <= maxShrink; shrink++) {
    result = arrange(shrink);
  }
  const title = result.lines.find((line) => line.field === 'title');
  return {
    ...result,
    decorations: coverDecorations(design.id, width, height, title && title.y - title.fontSize),
  };
}
