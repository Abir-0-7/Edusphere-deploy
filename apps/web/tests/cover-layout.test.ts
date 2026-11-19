import { describe, expect, it, vi } from 'vitest';
import { AcademicCoverDraftSchema, AcademicCoverTemplateSchema } from '@studyvault/types';
import { COVER_TEMPLATES, layoutCover, type CoverMeasure } from '../src/lib/cover-layout';

vi.mock('@studyvault/types', async () => import('../../../packages/types/src/cover-api'));

const completeContent = {
  institutionName: 'North Campus University',
  department: 'School of Engineering',
  courseCode: 'CS 240',
  courseName: 'Algorithms and Data Structures',
  assignmentNumber: 'Experiment 2',
  title: 'Search Trees',
  subtitle: 'A comparison of three approaches',
  students: [{ name: 'Rosa Pérez', id: 'S123', section: 'B' }, { name: 'Noah Smith' }],
  groupName: 'Team Cedar',
  instructorName: 'Dr. Rahman',
  date: '2026-11-18',
};

// Fixed metrics isolate the layout contract; E02 verifies font metrics on rendered exports.
const measure: CoverMeasure = (value, _font, size) => Array.from(value).length * size * 0.58;

const templateFixtures = [
  ['university-assignment', 'times-roman', 'center', 64, 80, 36],
  ['lab-report', 'courier', 'left', 54, 64, 30],
  ['project-report', 'helvetica', 'center', 76, 88, 40],
  ['minimal-professional', 'helvetica', 'left', 58, 92, 34],
] as const;

const paperFixtures = [
  ['a4', 595.28, 841.89],
  ['letter', 612, 792],
] as const;

describe.each(templateFixtures)('%s cover template', (templateId, font, align, margin, top, size) => {
  it.each(paperFixtures)('lays out a complete cover on %s', (pageSize, width, height) => {
    const template = COVER_TEMPLATES[templateId];
    expect(template.margins).toEqual({ left: margin, right: margin, bottom: margin, top });

    const layout = layoutCover({ templateId, pageSize, content: completeContent }, measure);
    expect(layout).toMatchObject({ width, height, overflow: false });
    expect(layout.lines.map((line) => line.field)).toEqual([
      'institutionName',
      'department',
      'assignmentNumber',
      'title',
      'subtitle',
      'courseCode',
      'courseName',
      'groupName',
      'students',
      'students',
      'instructorName',
      'date',
    ]);
    expect(layout.lines.find((line) => line.field === 'title')).toMatchObject({
      text: completeContent.title,
      fontFamily: font,
      fontSize: size,
      bold: true,
    });
    const group = layout.lines.filter((line) => line.field === 'students');
    expect(group[0]?.text).toMatch(/Rosa Pérez.*S123.*Section: B/u);
    expect(group[1]?.text).toBe('Noah Smith');

    for (const line of layout.lines) {
      expect(line.fontFamily).toBe(font);
      expect(line.x).toBeCloseTo(align === 'left' ? margin : (width - line.width) / 2);
      expect(line.x + line.width).toBeLessThanOrEqual(width - margin);
      expect(line.y - line.fontSize).toBeGreaterThanOrEqual(top);
      expect(line.y + line.fontSize * 0.28).toBeLessThanOrEqual(height - margin);
    }
  });

  it('omits blank fields without leaving gaps or labels', () => {
    const layout = layoutCover(
      {
        templateId,
        pageSize: 'letter',
        content: { title: '  Soil and Water  ', institutionName: '   ', groupName: '\n', students: [] },
      },
      measure,
    );
    expect(layout.overflow).toBe(false);
    expect(layout.lines).toMatchObject([{ field: 'title', text: 'Soil and Water', y: top + size }]);
  });
});

it('wraps and shrinks a long title that exceeds a template’s line cap at its initial size', () => {
  const title = 'e\u0301'.repeat(140);
  const layout = layoutCover(
    {
      templateId: 'project-report',
      pageSize: 'a4',
      content: { title },
    },
    measure,
  );
  expect(layout.overflow).toBe(false);
  expect(layout.lines.length).toBeGreaterThan(1);
  expect(layout.lines.length).toBeLessThanOrEqual(7);
  expect(layout.lines.map((line) => line.text).join('')).toBe(title);
  for (const line of layout.lines) {
    expect(line.text.startsWith('e')).toBe(true);
    expect(line.fontSize).toBeGreaterThanOrEqual(18);
    expect(line.fontSize).toBeLessThan(40);
  }
});

it('signals one-page overflow when the full group cannot fit even after shrinking', () => {
  const layout = layoutCover(
    {
      templateId: 'university-assignment',
      pageSize: 'letter',
      content: {
        title: 'Field project',
        students: Array.from({ length: 40 }, (_, index) => ({
          name: `Student ${index + 1} ${'Surname '.repeat(18).trim()}`,
        })),
      },
    },
    measure,
  );
  expect(layout.overflow).toBe(true);
  expect(layout.lines.some((line) => line.text.includes('Student 1 '))).toBe(true);
  expect(layout.lines.some((line) => line.text.includes('Student 40 '))).toBe(false);
  expect(layout.lines.at(-1)?.y).toBeLessThan(792 - 64);
});

it('validates page, template revision, text bounds, and minimum font size', () => {
  const draft = { templateId: 'project-report', pageSize: 'a4', content: { title: 'Report' } };
  expect(AcademicCoverDraftSchema.safeParse(draft).success).toBe(true);
  expect(AcademicCoverDraftSchema.safeParse({ ...draft, pageSize: 'legal' }).success).toBe(false);
  expect(AcademicCoverDraftSchema.safeParse({ ...draft, templateVersion: 2 }).success).toBe(false);
  expect(AcademicCoverDraftSchema.safeParse({ ...draft, content: { title: ' ' } }).success).toBe(false);
  expect(AcademicCoverDraftSchema.safeParse({ ...draft, content: { title: 'a'.repeat(401) } }).success).toBe(
    false,
  );
  const design = COVER_TEMPLATES['project-report'];
  const fields = design.fields.map((field) => ({ ...field, minFontSize: field.fontSize + 1 }));
  expect(AcademicCoverTemplateSchema.safeParse({ ...design, fields }).success).toBe(false);
});
