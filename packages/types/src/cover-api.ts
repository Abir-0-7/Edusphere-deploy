import { z } from 'zod';

/** Stable identifiers shared by the cover editor, saved drafts, and renderers. */
export const CoverTemplateIdSchema = z.enum([
  'university-assignment',
  'lab-report',
  'project-report',
  'minimal-professional',
]);
export type CoverTemplateId = z.infer<typeof CoverTemplateIdSchema>;

/** The fields are plain text only; renderers must escape them as text, never markup. */
export const AcademicCoverContentSchema = z.object({
  institutionName: z.string().trim().max(240).default(''),
  department: z.string().trim().max(240).default(''),
  courseCode: z.string().trim().max(80).default(''),
  courseName: z.string().trim().max(240).default(''),
  assignmentNumber: z.string().trim().max(80).default(''),
  title: z.string().trim().min(1).max(400),
  subtitle: z.string().trim().max(300).default(''),
  students: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        id: z.string().trim().max(80).default(''),
        section: z.string().trim().max(80).default(''),
      }),
    )
    .max(40)
    .default([]),
  groupName: z.string().trim().max(160).default(''),
  instructorName: z.string().trim().max(200).default(''),
  date: z.string().trim().max(64).default(''),
});
export type AcademicCoverContent = z.infer<typeof AcademicCoverContentSchema>;

export const CoverPageSizeSchema = z.enum(['a4', 'letter']);
export type CoverPageSize = z.infer<typeof CoverPageSizeSchema>;

/** Typography roles with corresponding font families in each renderer. */
export const CoverFontFamilySchema = z.enum(['helvetica', 'times-roman', 'courier']);
export type CoverFontFamily = z.infer<typeof CoverFontFamilySchema>;
export const CoverTextAlignmentSchema = z.enum(['left', 'center', 'right']);
export const CoverFieldKeySchema = AcademicCoverContentSchema.keyof();
export type CoverFieldKey = z.infer<typeof CoverFieldKeySchema>;

export const CoverMarginsSchema = z.object({
  top: z.number().int().min(24).max(180),
  right: z.number().int().min(24).max(180),
  bottom: z.number().int().min(24).max(180),
  left: z.number().int().min(24).max(180),
});

export const CoverFieldLayoutSchema = z
  .object({
    field: CoverFieldKeySchema,
    alignment: CoverTextAlignmentSchema,
    fontFamily: CoverFontFamilySchema,
    fontSize: z.number().int().min(8).max(48),
    minFontSize: z.number().int().min(8).max(48),
    maxLines: z.number().int().min(1).max(80),
    gapBefore: z.number().int().min(0).max(96),
    bold: z.boolean(),
  })
  .refine((layout) => layout.minFontSize <= layout.fontSize, {
    message: 'minFontSize must not exceed fontSize',
    path: ['minFontSize'],
  });

/** Version the template metadata independently from content and saved drafts. */
export const AcademicCoverTemplateSchema = z.object({
  id: CoverTemplateIdSchema,
  version: z.literal(1),
  label: z.string().min(1).max(80),
  pageSizes: z.array(CoverPageSizeSchema).min(1).max(2),
  margins: CoverMarginsSchema,
  fields: z
    .array(CoverFieldLayoutSchema)
    .min(1)
    .max(CoverFieldKeySchema.options.length)
    .refine(
      (fields) =>
        fields.some(({ field }) => field === 'title') &&
        new Set(fields.map(({ field }) => field)).size === fields.length,
      'A template must include the title and may show each field only once.',
    ),
});
export type AcademicCoverTemplate = z.infer<typeof AcademicCoverTemplateSchema>;

/** One persisted editor state. Template defaults are not copied into user content. */
export const AcademicCoverDraftSchema = z.object({
  templateId: CoverTemplateIdSchema,
  templateVersion: z.literal(1).default(1),
  pageSize: CoverPageSizeSchema,
  content: AcademicCoverContentSchema,
});
export type AcademicCoverDraft = z.infer<typeof AcademicCoverDraftSchema>;
