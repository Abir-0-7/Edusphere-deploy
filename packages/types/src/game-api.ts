import { z } from 'zod';

export const GameIdSchema = z.enum([
  'SortingRace',
  'NQueens',
  'TowersOfHanoi',
  'FlashcardTowerDefense',
  'ConceptMatch',
  'RetrievalSprint',
  'CodeTrace',
  'DebuggingDetective',
  'SQLDetective',
  'GraphPath',
  'ProofBuilder',
  'DataDetective',
  'AdaptiveQuiz',
  'ExamEscape',
]);
export type GameId = z.infer<typeof GameIdSchema>;
export const GameDifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type GameDifficulty = z.infer<typeof GameDifficultySchema>;
export const GameObjectiveSchema = z.enum([
  'python.arithmetic',
  'python.collections',
  'python.iteration',
  'python.branching',
]);
export type GameObjective = z.infer<typeof GameObjectiveSchema>;

export const GameActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('swap'),
    left: z.number().int().min(0).max(15),
    right: z.number().int().min(0).max(15),
  }),
  z.object({
    type: z.literal('place'),
    row: z.number().int().min(0).max(11),
    column: z.number().int().min(0).max(11),
  }),
  z.object({
    type: z.literal('move'),
    from: z.number().int().min(0).max(2),
    to: z.number().int().min(0).max(2),
  }),
  z.object({ type: z.literal('answer'), enemyId: z.number().int().min(1).max(8), answer: z.boolean() }),
  z.object({ type: z.literal('tick'), steps: z.number().int().min(1).max(600) }),
]);
export const GameCompletionRequestSchema = z.object({
  game_id: z.enum(['SortingRace', 'NQueens', 'TowersOfHanoi', 'FlashcardTowerDefense']),
  actions: z.array(GameActionSchema).min(1).max(2000),
});
export type GameCompletionRequest = z.infer<typeof GameCompletionRequestSchema>;
export const GameRewardResponseSchema = z.object({
  tokens_awarded: z.number().int().min(0).max(5),
  idempotent: z.boolean(),
});
export type GameRewardResponse = z.infer<typeof GameRewardResponseSchema>;

function hasValidObjectiveScope(value: { game_id: GameId; objective_id?: GameObjective }): boolean {
  return (
    value.objective_id === undefined ||
    ['FlashcardTowerDefense', 'ConceptMatch', 'RetrievalSprint', 'CodeTrace'].includes(value.game_id)
  );
}

const objectiveScopeIssue = {
  path: ['objective_id'],
  message: 'Only question games support a learning objective.',
};

export const GameConfigSchema = z
  .object({
    version: z.literal(1),
    game_id: GameIdSchema,
    difficulty: GameDifficultySchema,
    seed: z.number().int().min(0).max(0xffff_ffff),
    practice: z.boolean(),
    objective_id: GameObjectiveSchema.optional().describe(objectiveScopeIssue.message),
  })
  .strict()
  .refine(hasValidObjectiveScope, objectiveScopeIssue);
export type GameConfig = z.infer<typeof GameConfigSchema>;
export const VersionedGameActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('swap'),
      left: z.number().int().min(0).max(15),
      right: z.number().int().min(0).max(15),
    })
    .strict(),
  z
    .object({
      type: z.literal('place'),
      row: z.number().int().min(0).max(11),
      column: z.number().int().min(0).max(11),
    })
    .strict(),
  z
    .object({
      type: z.literal('move'),
      from: z.number().int().min(0).max(2),
      to: z.number().int().min(0).max(2),
    })
    .strict(),
  z
    .object({
      type: z.literal('answer'),
      question_id: z.string().min(1).max(128),
      choice: z.number().int().min(0).max(15),
    })
    .strict(),
  z.object({ type: z.literal('undo') }).strict(),
  z.object({ type: z.literal('hint') }).strict(),
  z
    .object({
      type: z.literal('debug'),
      question_id: z.string().min(1).max(128),
      line: z.number().int().min(0).max(15),
      repair: z.number().int().min(0).max(15),
    })
    .strict(),
  z
    .object({
      type: z.literal('path'),
      question_id: z.string().min(1).max(128),
      node_ids: z.array(z.string().min(1).max(24)).max(12),
    })
    .strict(),
  z
    .object({
      type: z.literal('order'),
      question_id: z.string().min(1).max(128),
      step_ids: z.array(z.string().min(1).max(24)).min(1).max(12),
    })
    .strict(),
]);
export type VersionedGameAction = z.infer<typeof VersionedGameActionSchema>;
export const OrderedGameActionSchema = z
  .object({ seq: z.number().int().min(1).max(500), action: VersionedGameActionSchema })
  .strict();
export type OrderedGameAction = z.infer<typeof OrderedGameActionSchema>;
export const GameSnapshotSchema = z
  .object({ config: GameConfigSchema, actions: z.array(OrderedGameActionSchema).max(500) })
  .strict();
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

const GameActivitySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('debug'),
      lines: z.array(z.string().max(160)).min(1).max(16),
      repairs: z.array(z.string().max(240)).min(2).max(16),
    })
    .strict(),
  z
    .object({
      kind: z.literal('sql'),
      columns: z.array(z.string().max(60)).min(1).max(8),
      rows: z.array(z.array(z.string().max(100)).max(8)).max(12),
      query: z.string().max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('graph'),
      nodes: z.array(z.string().min(1).max(24)).min(1).max(12),
      edges: z.array(z.tuple([z.string().max(24), z.string().max(24)])).max(40),
      start: z.string().max(24),
      goal: z.string().max(24),
    })
    .strict(),
  z
    .object({
      kind: z.literal('proof'),
      steps: z
        .array(z.object({ id: z.string().min(1).max(24), text: z.string().max(500) }).strict())
        .min(1)
        .max(12),
    })
    .strict(),
  z
    .object({
      kind: z.literal('data'),
      columns: z.array(z.string().max(60)).min(1).max(8),
      rows: z.array(z.array(z.string().max(100)).max(8)).max(12),
      units: z.string().max(120),
    })
    .strict(),
  z
    .object({ kind: z.literal('adaptive'), level: GameDifficultySchema, reason: z.string().max(300) })
    .strict(),
  z
    .object({
      kind: z.literal('escape'),
      room: z.string().max(100),
      position: z.number().int().min(1).max(12),
      total: z.number().int().min(1).max(12),
    })
    .strict(),
]);

export const GamePublicQuestionSchema = z
  .object({
    id: z.string().min(1).max(128),
    prompt: z.string().max(2_000),
    choices: z.array(z.string().max(500)).max(16),
    source: z.object({ label: z.string().max(120), url: z.string().url() }).strict(),
    activity: GameActivitySchema.optional(),
    progress: z
      .object({ current: z.number().int().min(1).max(12), total: z.number().int().min(1).max(12) })
      .strict()
      .optional(),
  })
  .strict();
export type GamePublicQuestion = z.infer<typeof GamePublicQuestionSchema>;
export const GameFeedbackSchema = z
  .object({
    question_id: z.string().min(1).max(128),
    correct: z.boolean(),
    explanation: z.string().max(2_000),
    source: z.object({ label: z.string().max(120), url: z.string().url() }).strict(),
  })
  .strict();
export const GamePublicViewSchema = z
  .object({
    values: z.array(z.number().finite()).max(16),
    columns: z.array(z.number().int().min(-1).max(11)).max(12),
    towers: z.array(z.array(z.number().int().min(1).max(8)).max(8)).length(3),
    question: GamePublicQuestionSchema.nullable(),
    feedback: GameFeedbackSchema.nullable(),
    correct: z.number().int().min(0).max(500),
    mistakes: z.number().int().min(0).max(500),
    hints: z.number().int().min(0).max(500),
    score: z.number().int().min(0),
    explanation: z.string().max(2_000),
  })
  .strict();
export type GamePublicView = z.infer<typeof GamePublicViewSchema>;

export const GameSessionStatusSchema = z.enum(['ready', 'playing', 'paused', 'won', 'lost', 'abandoned']);
export type GameSessionStatus = z.infer<typeof GameSessionStatusSchema>;
export const GameCreateInputSchema = z
  .object({
    game_id: GameIdSchema,
    difficulty: GameDifficultySchema.default('easy'),
    practice: z.boolean().default(false),
    objective_id: GameObjectiveSchema.optional().describe(objectiveScopeIssue.message),
  })
  .strict()
  .refine(hasValidObjectiveScope, objectiveScopeIssue);
export type GameCreateInput = z.infer<typeof GameCreateInputSchema>;
export const GameCommandInputSchema = z.discriminatedUnion('command', [
  z
    .object({
      revision: z.number().int().nonnegative(),
      command: z.enum(['start', 'pause', 'resume', 'abandon']),
    })
    .strict(),
  z
    .object({
      revision: z.number().int().nonnegative(),
      command: z.literal('act'),
      action: OrderedGameActionSchema,
    })
    .strict(),
]);
export type GameCommandInput = z.infer<typeof GameCommandInputSchema>;
export const GameSessionSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    snapshot: GameSnapshotSchema,
    view: GamePublicViewSchema,
    status: GameSessionStatusSchema,
    tokens_awarded: z.number().int().min(0).max(5),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type GameSession = z.infer<typeof GameSessionSchema>;
export const GameSessionListSchema = z
  .object({
    sessions: z.array(GameSessionSchema).max(100),
    progression: z.record(GameIdSchema, z.number().int().nonnegative()),
  })
  .strict();
export type GameSessionList = z.infer<typeof GameSessionListSchema>;
