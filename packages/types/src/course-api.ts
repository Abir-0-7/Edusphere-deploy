import { z } from 'zod';
import { RunnerProblemIdSchema } from './code-runner-api';
import { EvidencePinSchema } from './source-version-api';

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

export const EvidenceSchema = z
  .strictObject({
    id: StrictString,
    source_id: StrictString,
    locator: StrictString,
    quote: StrictString,
    source_pin: EvidencePinSchema.optional(),
  })
  .refine((evidence) => evidence.source_pin === undefined || evidence.source_pin.quote === evidence.quote, {
    path: ['source_pin', 'quote'],
    message: 'Pinned quote must match the course evidence exactly.',
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

const CourseLabTaskSchema = z.strictObject({
  id: StrictString,
  title: StrictString,
  prompt: StrictString,
  objective_ids: z.array(StrictString).min(1),
  evidence_ids: z.array(StrictString).min(1),
  runner_problem_id: RunnerProblemIdSchema.nullable().optional(),
  starter: z.string().max(4000).nullable().optional(),
  starter_javascript: z.string().max(4000).nullable().optional(),
  expected_query: z.string().nullable().optional(),
  expected_output: z.string().nullable().optional(),
});
const CourseLabSchema = z.strictObject({
  id: StrictString.max(120),
  title: StrictString.max(200),
  kind: z.enum(['sql_query', 'git_shell', 'code_editor']),
  instructions: StrictString.max(2000),
  workspace: StrictString.max(4000),
  starter: z.string().max(4000),
  tasks: z.array(CourseLabTaskSchema).min(1).max(12),
});
const CourseLabViewSchema = CourseLabSchema.extend({
  tasks: z
    .array(CourseLabTaskSchema.omit({ expected_query: true, expected_output: true }))
    .min(1)
    .max(12),
});
export type CourseLab = z.infer<typeof CourseLabSchema>;
export type CourseLabView = z.infer<typeof CourseLabViewSchema>;
export const AssignmentCriterionSchema = z.strictObject({
  id: StrictString.max(120),
  description: StrictString.max(2000),
  objective_ids: z.array(StrictString).min(1).max(30),
  evidence_ids: z.array(StrictString).min(1).max(100),
  review_guidance: StrictString.max(2000),
});
export type AssignmentCriterion = z.infer<typeof AssignmentCriterionSchema>;
export const AssignmentSectionSchema = z
  .strictObject({
    id: StrictString.max(120),
    title: StrictString.max(200),
    prompt: StrictString.max(2000),
    min_chars: z.number().int().min(0).max(5000),
    max_chars: z.number().int().min(1).max(5000),
  })
  .refine((section) => section.min_chars <= section.max_chars, {
    message: 'Assignment section minimum exceeds its maximum.',
    path: ['min_chars'],
  });
export type AssignmentSection = z.infer<typeof AssignmentSectionSchema>;
export const CourseAssignmentSchema = z
  .strictObject({
    id: StrictString.max(120),
    title: StrictString.max(200),
    prompt: StrictString.max(3000),
    deliverable: StrictString.max(2000),
    rubric: z.array(StrictString).min(1).max(12),
    objective_ids: z.array(StrictString).min(1),
    evidence_ids: z.array(StrictString).min(1),
    criteria: z.array(AssignmentCriterionSchema).max(12).default([]),
    sections: z.array(AssignmentSectionSchema).max(8).default([]),
    require_evidence: z.boolean().default(false),
  })
  .superRefine((assignment, context) => {
    if (
      new Set(assignment.criteria.map((item) => item.id)).size !== assignment.criteria.length ||
      new Set(assignment.sections.map((item) => item.id)).size !== assignment.sections.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Assignment criterion and section identifiers must be unique.',
      });
    }
    if (assignment.sections.reduce((sum, section) => sum + section.min_chars, 0) > 20000) {
      context.addIssue({
        code: 'custom',
        message: 'Assignment section minima exceed the total submission bound.',
      });
    }
    for (const criterion of assignment.criteria) {
      if (
        !criterion.objective_ids.every((id) => assignment.objective_ids.includes(id)) ||
        !criterion.evidence_ids.every((id) => assignment.evidence_ids.includes(id)) ||
        new Set(criterion.objective_ids).size !== criterion.objective_ids.length ||
        new Set(criterion.evidence_ids).size !== criterion.evidence_ids.length
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Rubric criteria must link unique assignment objectives and evidence.',
        });
      }
    }
  });
export type CourseAssignment = z.infer<typeof CourseAssignmentSchema>;

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
    labs: z.array(CourseLabSchema).max(12).default([]),
    assignments: z.array(CourseAssignmentSchema).max(8).default([]),
    required_assignment_ids: z.array(StrictString).max(8).default([]),
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
    const labIds = release.labs.map((lab) => lab.id);
    const assignmentIds = release.assignments.map((assignment) => assignment.id);
    if (
      !unique(release.required_assignment_ids) ||
      !release.required_assignment_ids.every((id) => assignmentIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['required_assignment_ids'],
        message: 'Required assignments are invalid.',
      });
    }
    if (
      !unique(sourceIds) ||
      !unique(evidenceIds) ||
      !unique(objectiveIds) ||
      !unique(exerciseIds) ||
      !unique(lessonIds) ||
      !unique(labIds) ||
      !unique(assignmentIds)
    ) {
      context.addIssue({ code: 'custom', path: ['lessons'], message: 'Course identifiers must be unique.' });
    }

    const sources = new Map(release.sources.map((source) => [source.id, source]));
    const evidence = new Map(release.evidence.map((item) => [item.id, item]));
    const objectives = new Map(release.objectives.map((objective) => [objective.id, objective]));
    const exercises = new Map(release.exercises.map((exercise) => [exercise.id, exercise]));
    for (const lab of release.labs) {
      const taskIds = lab.tasks.map((task) => task.id);
      if (!unique(taskIds)) {
        context.addIssue({ code: 'custom', path: ['labs'], message: 'Lab task identifiers must be unique.' });
      }
      for (const task of lab.tasks) {
        if (
          !task.objective_ids.every((id) => objectives.has(id)) ||
          !task.evidence_ids.every((id) => evidence.has(id)) ||
          (lab.kind === 'sql_query' && (!task.expected_query || !task.expected_output))
        ) {
          context.addIssue({
            code: 'custom',
            path: ['labs'],
            message: 'Lab task links or SQL target are invalid.',
          });
        }
      }
    }
    for (const assignment of release.assignments) {
      if (
        !assignment.objective_ids.every((id) => objectives.has(id)) ||
        !assignment.evidence_ids.every((id) => evidence.has(id))
      ) {
        context.addIssue({ code: 'custom', path: ['assignments'], message: 'Assignment links are invalid.' });
      }
    }
    for (const item of release.evidence) {
      if (release.visibility === 'catalog' && item.source_pin !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: 'Private source pins cannot enter the catalog without editorial review.',
        });
      }
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
  labs: z.array(CourseLabViewSchema).max(12).default([]),
  assignments: z.array(CourseAssignmentSchema).max(8).default([]),
  required_assignment_ids: z.array(StrictString).max(8).default([]),
}).strict();
export type CourseDetail = z.infer<typeof CourseDetailSchema>;

export const MaterialEvidenceSchema = EvidenceSchema.safeExtend({
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

const DepthSchema = z.enum(['guided', 'standard', 'concise']);
const PaceSchema = z.enum(['short_sessions', 'standard']);
const RoleSchema = z.enum(['analyst', 'developer']);
const AdaptationSchema = z.strictObject({
  role: RoleSchema,
  explanation_depth: DepthSchema,
  pace: PaceSchema,
  variants: z.array(
    z.strictObject({
      objective_id: StrictString,
      role: RoleSchema,
      example_title: StrictString,
      example: StrictString,
      explanation_depth: DepthSchema,
      depth_note: StrictString,
      pace: PaceSchema,
      pace_note: StrictString,
      evidence_ids: z.array(StrictString).min(1),
    }),
  ),
});
const RemediationSchema = z.strictObject({
  objective_id: StrictString,
  step: z.enum(['bridge', 'checkpoint']),
  title: StrictString,
  explanation: StrictString,
  worked_example: StrictString,
  evidence_ids: z.array(StrictString).min(1),
  exercise: ExerciseSchema,
});
const LabTranscriptSchema = z.strictObject({
  text: z.string().max(20_000),
  output: z.string().max(2000),
  accepted: z.boolean(),
  progress: z.number().int().nonnegative(),
});

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
  adaptation: AdaptationSchema.nullable().default(null),
  remediation: RemediationSchema.nullable().default(null),
  assignment_drafts: z.record(z.string(), z.string()).default({}),
  assignment_status: z.record(z.string(), z.enum(['draft', 'submitted'])).default({}),
  assignment_sections: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  assignment_evidence_ids: z.record(z.string(), z.array(z.string())).default({}),
  lab_progress: z.record(z.string(), z.number().int().nonnegative()).default({}),
  lab_transcripts: z.record(z.string(), z.array(LabTranscriptSchema)).default({}),
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

export const AssignmentDraftRequestSchema = z
  .strictObject({
    id: Uuid,
    revision: z.number().int().nonnegative(),
    assignment_id: StrictString.max(120),
    action: z.enum(['save', 'submit']),
    text: z.string().max(5000).default(''),
    sections: z
      .record(
        StrictString.max(120),
        z.string().refine((value) => Array.from(value).length <= 5000, {
          message: 'Assignment section exceeds 5000 Unicode characters.',
        }),
      )
      .default({}),
    evidence_ids: z.array(StrictString.max(200)).max(100).default([]),
  })
  .superRefine((request, context) => {
    if (
      Object.keys(request.sections).length > 8 ||
      Object.values(request.sections).reduce((sum, value) => sum + Array.from(value).length, 0) > 20000
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'Assignment sections exceed their bounded limit.',
      });
    }
    if (new Set(request.evidence_ids).size !== request.evidence_ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['evidence_ids'],
        message: 'Assignment evidence must be unique.',
      });
    }
    const invalidUnicode = (value: string): boolean => {
      for (let i = 0; i < value.length; i += 1) {
        const unit = value.charCodeAt(i);
        if (unit === 0) return true;
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = value.charCodeAt(i + 1);
          if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
          i += 1;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
      }
      return false;
    };
    if (
      [
        request.text,
        ...Object.keys(request.sections),
        ...Object.values(request.sections),
        ...request.evidence_ids,
      ].some(invalidUnicode)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Assignment text must contain valid Unicode without NUL.',
      });
    }
  });
export type AssignmentDraftRequest = z.input<typeof AssignmentDraftRequestSchema>;
export const AssignmentDraftResponseSchema = z.strictObject({
  id: Uuid,
  assignment_id: StrictString,
  status: z.enum(['draft', 'submitted']),
  revision: z.number().int(),
  replayed: z.boolean(),
  sections: z.record(z.string(), z.string()).default({}),
  evidence_ids: z.array(z.string()).max(100).default([]),
});
export type AssignmentDraftResponse = z.infer<typeof AssignmentDraftResponseSchema>;
export const LabRunRequestSchema = z.strictObject({
  id: Uuid,
  revision: z.number().int().nonnegative(),
  lab_id: StrictString.max(120),
  task_id: z.string().max(120).nullable().optional(),
  text: z.string().max(4000),
  runner_receipt: z.string().max(256).nullable().optional(),
  runner_problem_id: RunnerProblemIdSchema.nullable().optional(),
  runner_language: z.enum(['python', 'javascript']).nullable().optional(),
});
export type LabRunRequest = z.infer<typeof LabRunRequestSchema>;
export const LabRunResponseSchema = z.strictObject({
  id: Uuid,
  lab_id: StrictString,
  output: z.string().max(2000),
  accepted: z.boolean(),
  progress: z.number().int().nonnegative(),
  complete: z.boolean(),
  revision: z.number().int(),
  replayed: z.boolean(),
});
export type LabRunResponse = z.infer<typeof LabRunResponseSchema>;

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
