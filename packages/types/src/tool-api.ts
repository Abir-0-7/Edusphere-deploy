import { z } from 'zod';

/** Existing tool HTTP shapes. Generated output constraints mirror their Python models. */
export const CitationStyleSchema = z.enum(['apa', 'mla', 'ieee']);
export const CitationRequestSchema = z.object({
  style: z.string().trim().toLowerCase().pipe(CitationStyleSchema),
  authors: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  title: z.string().trim().max(2000).default(''),
  year: z.string().trim().max(32).default(''),
  container: z.string().trim().max(1000).default(''),
  url: z.string().trim().max(2048).default(''),
  pages: z.string().trim().max(100).default(''),
});
export const CitationResponseSchema = z.object({ citation: z.string(), style: CitationStyleSchema });
export type CitationResponse = z.infer<typeof CitationResponseSchema>;

export const CodeReviewRequestSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(6000)
      .refine((code) => code.trim().length > 0, 'code is required'),
    language: z
      .string()
      .trim()
      .max(100)
      .transform((language) => language || 'unknown')
      .default('unknown'),
    context: z.string().max(1500).optional(),
  })
  .strict();
export const CodeReviewResponseSchema = z
  .object({
    time_complexity: z.string().min(1).max(100),
    space_complexity: z.string().min(1).max(100),
    explanation: z.string().min(1).max(1500),
    assumptions: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
    steps: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
    improvements: z.array(z.string().min(1).max(500)).max(4).default([]),
    notes: z
      .array(
        z
          .object({
            line: z.number().int().positive().nullable().default(null),
            note: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict();
export type CodeReviewResponse = z.infer<typeof CodeReviewResponseSchema>;
