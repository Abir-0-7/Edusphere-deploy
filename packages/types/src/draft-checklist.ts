import { z } from 'zod';

export const ChecklistCriterionSchema = z.strictObject({
  id: z.uuid(),
  label: z.string().trim().min(1).max(240),
  status: z.enum(['not-reviewed', 'supported', 'needs-work']),
  evidence: z.string().max(1500),
  note: z.string().max(500),
});
export const DraftChecklistSchema = z
  .strictObject({
    format: z.literal('studyvault-draft-checklist'),
    schema_version: z.literal(1),
    id: z.uuid(),
    revision: z.number().int().positive(),
    updated_at: z.iso.datetime(),
    title: z.string().trim().min(1).max(160),
    draft: z.string().max(10_000),
    criteria: z.array(ChecklistCriterionSchema).min(1).max(12),
  })
  .superRefine((value, context) => {
    const ids = value.criteria.map((item) => item.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', path: ['criteria'], message: 'Criterion IDs must be unique.' });
    for (const [index, item] of value.criteria.entries()) {
      if (item.evidence && !value.draft.includes(item.evidence))
        context.addIssue({
          code: 'custom',
          path: ['criteria', index, 'evidence'],
          message: 'Evidence must quote the current draft exactly.',
        });
      if (item.status === 'supported' && !item.evidence.trim())
        context.addIssue({
          code: 'custom',
          path: ['criteria', index, 'status'],
          message: 'A supported item requires a draft excerpt.',
        });
    }
  });
export type DraftChecklist = z.infer<typeof DraftChecklistSchema>;
export type ChecklistCriterion = z.infer<typeof ChecklistCriterionSchema>;
