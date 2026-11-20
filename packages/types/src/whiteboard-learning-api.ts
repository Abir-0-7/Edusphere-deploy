import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .refine(
      (value) =>
        value === value.trim() &&
        value.length > 0 &&
        [...value].length <= max &&
        !/[\uD800-\uDFFF]/u.test(value) &&
        !value.includes(String.fromCharCode(0)),
    );
const shapeId = text(160);
const shapeIds = z
  .array(shapeId)
  .min(1)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length);
// Excerpts preserve the exact saved text, including intentional whitespace.
const excerptText = z
  .string()
  .refine(
    (value) =>
      value.trim().length > 0 &&
      [...value].length <= 600 &&
      !/[\uD800-\uDFFF]/u.test(value) &&
      !value.includes(String.fromCharCode(0)),
  );
export const BoardLearningActionSchema = z.enum(['tutor', 'cards', 'map']);
const revision = z.number().int().positive();
const selection = { revision, shape_ids: shapeIds };
export const BoardLearningRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...selection, action: z.literal('tutor'), question: text(240) }),
  z.strictObject({ ...selection, action: z.literal('cards') }),
  z.strictObject({ ...selection, action: z.literal('map') }),
]);
export type BoardLearningAction = z.infer<typeof BoardLearningActionSchema>;

export const BoardLearningResponseSchema = z
  .strictObject({
    board_id: z.uuid(),
    revision,
    action: BoardLearningActionSchema,
    excerpts: z
      .array(z.strictObject({ id: shapeId, text: excerptText }))
      .min(1)
      .max(20),
    answer: text(1200).nullable(),
    answer_excerpt_ids: z.union([shapeIds, z.tuple([])]),
    cards: z.array(z.strictObject({ front: text(220), back: text(700), excerpt_ids: shapeIds })).max(5),
    nodes: z.array(z.strictObject({ label: text(180), excerpt_ids: shapeIds })).max(5),
  })
  .refine((preview) => {
    const excerpts = new Set(preview.excerpts.map((excerpt) => excerpt.id));
    if (excerpts.size !== preview.excerpts.length) return false;
    if (
      preview.action === 'tutor' &&
      (!preview.answer || preview.cards.length || preview.nodes.length || !preview.answer_excerpt_ids.length)
    )
      return false;
    if (
      preview.action === 'cards' &&
      (preview.answer || !preview.cards.length || preview.nodes.length || preview.answer_excerpt_ids.length)
    )
      return false;
    if (
      preview.action === 'map' &&
      (preview.answer || preview.cards.length || !preview.nodes.length || preview.answer_excerpt_ids.length)
    )
      return false;
    return [
      ...preview.answer_excerpt_ids,
      ...preview.cards.flatMap((card) => card.excerpt_ids),
      ...preview.nodes.flatMap((node) => node.excerpt_ids),
    ].every((id) => excerpts.has(id));
  }, 'The preview must match its action and cite text from the selected area.');
export type BoardLearningResponse = z.infer<typeof BoardLearningResponseSchema>;
