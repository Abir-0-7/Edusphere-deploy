import { z } from 'zod';

/** Wire contracts for the authored, deterministic course catalog and sessions. */
const StrictString = z.string().min(1);
const Uuid = z.string().uuid();
const Answer = z.union([z.string(), z.number().finite(), z.array(z.string())]);
export type Answer = z.infer<typeof Answer>;

export const CourseSourceSchema = z.strictObject({
  id: StrictString,
  title: StrictString,
  body: StrictString,
  reference_urls: z
    .array(z.url().refine((url) => ['http:', 'https:'].includes(new URL(url).protocol)))
    .default([]),
});
export type CourseSource = z.infer<typeof CourseSourceSchema>;

export const EvidenceSchema = z.strictObject({
  id: StrictString,
  source_id: StrictString,
  locator: StrictString,
  quote: StrictString,
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ObjectiveSchema = z.strictObject({
  id: StrictString,
  title: StrictString,
  prerequisites: z.array(z.string()).default([]),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

export const TeachingBlockSchema = z.strictObject({
  id: StrictString,
  type: z.enum(['explanation', 'example', 'code', 'recap']),
  content: StrictString,
  language: z.string().nullable().default(null),
  evidence_ids: z.array(StrictString).min(1),
});
export type TeachingBlock = z.infer<typeof TeachingBlockSchema>;

export const ChoiceSchema = z.strictObject({ id: StrictString, label: StrictString });
export type Choice = z.infer<typeof ChoiceSchema>;

export const ExerciseSchema = z.strictObject({
  id: StrictString,
  kind: z.enum(['choice', 'number', 'ordered', 'multiple']),
  mode: z.enum(['practice', 'checkpoint']),
  prompt: StrictString,
  choices: z.array(ChoiceSchema).default([]),
  objective_ids: z.array(StrictString).min(1),
  evidence_ids: z.array(StrictString).min(1),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

export const ExerciseKeySchema = ExerciseSchema.extend({
  answer: Answer,
  explanation: StrictString,
  hint: StrictString,
});
export type ExerciseKey = z.infer<typeof ExerciseKeySchema>;

export const LessonSchema = z.strictObject({
  id: StrictString,
  title: StrictString,
  objective_ids: z.array(StrictString).min(1),
  blocks: z.array(TeachingBlockSchema).min(1),
  practice_ids: z.array(StrictString).min(1),
  checkpoint_ids: z.array(StrictString).min(1),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const ModuleSchema = z.strictObject({
  id: StrictString,
  title: StrictString,
  lesson_ids: z.array(StrictString).min(1),
});
export type Module = z.infer<typeof ModuleSchema>;

const unique = (items: readonly string[]): boolean => new Set(items).size === items.length;
const normalized = (text: string): string => text.trim().replace(/\s+/g, ' ');

export const CourseReleaseSchema = z
  .strictObject({
    id: Uuid,
    course_id: Uuid,
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: StrictString,
    description: StrictString,
    version: StrictString,
    size: z.enum(['mini', 'full']),
    origin: z.enum(['prebuilt', 'generated', 'hybrid']),
    visibility: z.enum(['catalog', 'private']),
    status: z.enum(['draft', 'validated', 'reviewed', 'published', 'retired']),
    user_id: z.string().nullable().default(null),
    estimated_minutes: z.number().int().min(1).max(100000),
    prerequisites: z.array(z.string()).default([]),
    sources: z.array(CourseSourceSchema).min(1),
    evidence: z.array(EvidenceSchema).min(1),
    objectives: z.array(ObjectiveSchema).min(1),
    modules: z.array(ModuleSchema).min(1),
    lessons: z.array(LessonSchema).min(1),
    exercises: z.array(ExerciseKeySchema).min(1),
  })
  .superRefine((release, context) => {
    if (release.visibility === 'private' && !release.user_id) {
      context.addIssue({ code: 'custom', path: ['user_id'], message: 'Private releases require an owner.' });
    }
    if (release.visibility === 'catalog' && release.user_id !== null) {
      context.addIssue({
        code: 'custom',
        path: ['user_id'],
        message: 'Catalog releases cannot have an owner.',
      });
    }

    const sourceIds = release.sources.map((source) => source.id);
    const evidenceIds = release.evidence.map((item) => item.id);
    const objectiveIds = release.objectives.map((objective) => objective.id);
    const exerciseIds = release.exercises.map((exercise) => exercise.id);
    const lessonIds = release.lessons.map((lesson) => lesson.id);
    if (
      !unique(sourceIds) ||
      !unique(evidenceIds) ||
      !unique(objectiveIds) ||
      !unique(exerciseIds) ||
      !unique(lessonIds)
    ) {
      context.addIssue({ code: 'custom', path: ['lessons'], message: 'Course identifiers must be unique.' });
    }

    const sources = new Map(release.sources.map((source) => [source.id, source]));
    const evidence = new Map(release.evidence.map((item) => [item.id, item]));
    const objectives = new Map(release.objectives.map((objective) => [objective.id, objective]));
    const exercises = new Map(release.exercises.map((exercise) => [exercise.id, exercise]));
    for (const item of release.evidence) {
      const source = sources.get(item.source_id);
      if (!source || !normalized(source.body).includes(normalized(item.quote))) {
        context.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: 'Evidence quote must exist in its source.',
        });
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) {
        context.addIssue({
          code: 'custom',
          path: ['objectives'],
          message: 'Objective prerequisites contain a cycle.',
        });
        return;
      }
      const objective = objectives.get(id);
      if (!objective) {
        context.addIssue({
          code: 'custom',
          path: ['objectives'],
          message: 'Unknown objective prerequisite.',
        });
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      objective.prerequisites.forEach(visit);
      visiting.delete(id);
      visited.add(id);
    };
    release.objectives.forEach((objective) => visit(objective.id));

    for (const exercise of release.exercises) {
      if (
        !exercise.objective_ids.every((id) => objectives.has(id)) ||
        !exercise.evidence_ids.every((id) => evidence.has(id))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['exercises'],
          message: 'Exercise references an unknown objective or evidence.',
        });
      }
      const choiceIds = exercise.choices.map((choice) => choice.id);
      if (!unique(choiceIds))
        context.addIssue({
          code: 'custom',
          path: ['exercises'],
          message: 'Choice identifiers must be unique.',
        });
      if (
        exercise.kind === 'choice' &&
        (typeof exercise.answer !== 'string' || !choiceIds.includes(exercise.answer))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['exercises'],
          message: 'Choice answer must identify an offered choice.',
        });
      }
      if (
        exercise.kind === 'number' &&
        (typeof exercise.answer !== 'number' || !Number.isFinite(exercise.answer))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['exercises'],
          message: 'Number exercise requires a numeric key.',
        });
      }
      if (exercise.kind === 'ordered' || exercise.kind === 'multiple') {
        if (
          !Array.isArray(exercise.answer) ||
          !exercise.answer.length ||
          !unique(exercise.answer) ||
          !exercise.answer.every((id) => choiceIds.includes(id))
        ) {
          context.addIssue({
            code: 'custom',
            path: ['exercises'],
            message: 'List answer must identify choices.',
          });
        } else if (exercise.kind === 'ordered' && new Set(exercise.answer).size !== new Set(choiceIds).size) {
          context.addIssue({
            code: 'custom',
            path: ['exercises'],
            message: 'Ordered key must include every choice once.',
          });
        }
      }
    }

    const moduleLessonIds = release.modules.flatMap((module) => module.lesson_ids);
    if (
      !unique(release.modules.map((module) => module.id)) ||
      moduleLessonIds.join('|') !== lessonIds.join('|')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['modules'],
        message: 'Modules must contain each lesson once in teaching order.',
      });
    }
    const taught = new Set<string>();
    const seenBlocks = new Set<string>();
    for (const lesson of release.lessons) {
      if (!lesson.objective_ids.every((id) => objectives.has(id))) {
        context.addIssue({
          code: 'custom',
          path: ['lessons'],
          message: 'Lesson references an unknown objective.',
        });
      }
      for (const id of lesson.objective_ids) {
        const objective = objectives.get(id);
        if (objective && !objective.prerequisites.every((prerequisite) => taught.has(prerequisite))) {
          context.addIssue({
            code: 'custom',
            path: ['lessons'],
            message: 'Objective prerequisite must be taught earlier.',
          });
        }
      }
      lesson.objective_ids.forEach((id) => taught.add(id));
      const material = normalized(lesson.blocks.map((block) => block.content).join(' '));
      for (const block of lesson.blocks) {
        if (seenBlocks.has(block.id) || !block.evidence_ids.every((id) => evidence.has(id))) {
          context.addIssue({
            code: 'custom',
            path: ['lessons'],
            message: 'Teaching block identifier or evidence is invalid.',
          });
        }
        seenBlocks.add(block.id);
        if (block.evidence_ids.some((id) => !material.includes(normalized(evidence.get(id)?.quote ?? '')))) {
          context.addIssue({
            code: 'custom',
            path: ['lessons'],
            message: 'Lesson evidence must be included in teaching content.',
          });
        }
      }
      for (const [mode, ids] of [
        ['practice', lesson.practice_ids],
        ['checkpoint', lesson.checkpoint_ids],
      ] as const) {
        if (!unique(ids) || ids.some((id) => !exercises.has(id) || exercises.get(id)?.mode !== mode)) {
          context.addIssue({
            code: 'custom',
            path: ['lessons'],
            message: 'Lesson references an invalid exercise.',
          });
        }
        if (
          ids.some(
            (id) =>
              !exercises
                .get(id)
                ?.objective_ids.every((objective) => lesson.objective_ids.includes(objective)),
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['lessons'],
            message: 'Exercise objectives do not belong to its lesson.',
          });
        }
      }
    }
  });
export type CourseRelease = z.infer<typeof CourseReleaseSchema>;

export const CourseSummarySchema = z.strictObject({
  id: Uuid,
  release_id: Uuid,
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  version: z.string(),
  size: z.enum(['mini', 'full']),
  origin: z.enum(['prebuilt', 'generated', 'hybrid']),
  estimated_minutes: z.number().int(),
  lesson_count: z.number().int(),
  prerequisites: z.array(z.string()),
});
export type CourseSummary = z.infer<typeof CourseSummarySchema>;

export const CatalogResponseSchema = z.strictObject({ courses: z.array(CourseSummarySchema) });
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>;

export const CourseDetailSchema = CourseSummarySchema.extend({
  objectives: z.array(ObjectiveSchema),
  lesson_titles: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  reference_urls: z.array(z.string()),
  prerequisite_met: z.boolean(),
  modules: z.array(ModuleSchema),
}).strict();
export type CourseDetail = z.infer<typeof CourseDetailSchema>;

export const MaterialEvidenceSchema = EvidenceSchema.extend({
  document_id: Uuid,
  chapter_id: Uuid,
  chunk_id: Uuid,
}).strict();
export type MaterialEvidence = z.infer<typeof MaterialEvidenceSchema>;

export const LessonViewSchema = z.strictObject({
  id: StrictString,
  title: StrictString,
  objective_ids: z.array(StrictString).min(1),
  blocks: z.array(TeachingBlockSchema).min(1),
  practice: z.array(ExerciseSchema),
  checkpoint: ExerciseSchema.nullable(),
});
export type LessonView = z.infer<typeof LessonViewSchema>;

export const LessonSummarySchema = z.strictObject({
  id: StrictString,
  title: StrictString,
  completed: z.boolean(),
  objective_ids: z.array(StrictString).default([]),
  demonstrated_objective_ids: z.array(StrictString).default([]),
});
export type LessonSummary = z.infer<typeof LessonSummarySchema>;

export const LastActionSchema = z.strictObject({
  id: Uuid,
  exercise_id: StrictString,
  kind: z.enum(['attempt', 'hint', 'reveal']),
  answer: Answer.nullable(),
  correct: z.boolean().nullable(),
  message: z.string(),
  revision: z.number().int(),
});
export type LastAction = z.infer<typeof LastActionSchema>;

export const CourseChatMessageSchema = z.strictObject({
  id: Uuid,
  role: z.enum(['user', 'assistant']),
  content: StrictString.max(4000),
  evidence_ids: z.array(StrictString).max(20),
});
export type CourseChatMessage = z.infer<typeof CourseChatMessageSchema>;

export const SessionResponseSchema = z.strictObject({
  id: Uuid,
  release_id: Uuid,
  document_id: Uuid,
  course_slug: z.string(),
  course_title: z.string(),
  revision: z.number().int(),
  status: z.enum(['active', 'completed']),
  completed_lesson_ids: z.array(z.string()),
  lessons: z.array(LessonSummarySchema),
  lesson: LessonViewSchema,
  evidence: z.array(MaterialEvidenceSchema),
  last_action: LastActionSchema.nullable(),
  notes: z.array(z.strictObject({ id: Uuid, lesson_id: StrictString, text: z.string().max(5000) })).max(100),
  bookmarks: z.array(z.strictObject({ lesson_id: StrictString, evidence_id: StrictString })).max(100),
  conversation: z.array(CourseChatMessageSchema).max(40),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const SessionListResponseSchema = z.strictObject({ sessions: z.array(SessionResponseSchema) });
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const DiagnosticQuestionSchema = z.strictObject({
  id: z.string(),
  prompt: z.string(),
  kind: z.enum(['number', 'text']),
});
export type DiagnosticQuestion = z.infer<typeof DiagnosticQuestionSchema>;
export const DiagnosticResponseSchema = z.strictObject({ questions: z.array(DiagnosticQuestionSchema) });
export type DiagnosticResponse = z.infer<typeof DiagnosticResponseSchema>;

export const EnrollmentRequestSchema = z.strictObject({
  diagnostic_answers: z.record(z.string(), Answer).nullable().default(null),
});
export type EnrollmentRequest = z.infer<typeof EnrollmentRequestSchema>;

export const AttemptRequestSchema = z.strictObject({
  id: Uuid,
  revision: z.number().int().nonnegative(),
  exercise_id: z.string().min(1).max(200),
  answer: Answer,
});
export type AttemptRequest = z.infer<typeof AttemptRequestSchema>;

export const AssistanceRequestSchema = z.strictObject({
  id: Uuid,
  revision: z.number().int().nonnegative(),
  exercise_id: z.string().min(1).max(200),
  kind: z.enum(['hint', 'reveal']),
});
export type AssistanceRequest = z.infer<typeof AssistanceRequestSchema>;

export const AdvanceRequestSchema = z.strictObject({ revision: z.number().int().nonnegative() });
export type AdvanceRequest = z.infer<typeof AdvanceRequestSchema>;

export const StudyNotesRequestSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  notes: z.array(z.strictObject({ id: Uuid, lesson_id: StrictString, text: z.string().max(5000) })).max(100),
  bookmarks: z.array(z.strictObject({ lesson_id: StrictString, evidence_id: StrictString })).max(100),
});
export type StudyNotesRequest = z.infer<typeof StudyNotesRequestSchema>;

export const CourseChatRequestSchema = z.strictObject({
  id: Uuid,
  revision: z.number().int().nonnegative(),
  question: StrictString.min(1).max(2000),
});
export type CourseChatRequest = z.infer<typeof CourseChatRequestSchema>;

export const CourseChatResponseSchema = z.strictObject({
  id: Uuid,
  question: StrictString.max(2000),
  answer: StrictString.max(4000),
  evidence_ids: z.array(StrictString).max(20),
  revision: z.number().int(),
  replayed: z.boolean(),
});
export type CourseChatResponse = z.infer<typeof CourseChatResponseSchema>;

export const CourseChatTokenSchema = z.strictObject({ text: z.string().min(1).max(4000) });
export type CourseChatToken = z.infer<typeof CourseChatTokenSchema>;

export const AttemptResponseSchema = z.strictObject({
  id: Uuid,
  exercise_id: z.string(),
  correct: z.boolean(),
  independent: z.boolean(),
  lesson_complete: z.boolean(),
  course_complete: z.boolean(),
  feedback: z.string(),
  revision: z.number().int(),
  replayed: z.boolean(),
});
export type AttemptResponse = z.infer<typeof AttemptResponseSchema>;

export const AssistanceResponseSchema = z.strictObject({
  id: Uuid,
  exercise_id: z.string(),
  kind: z.enum(['hint', 'reveal']),
  message: z.string(),
  revision: z.number().int(),
  replayed: z.boolean(),
});
export type AssistanceResponse = z.infer<typeof AssistanceResponseSchema>;
