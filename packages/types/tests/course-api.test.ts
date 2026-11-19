import { describe, expect, it } from 'vitest';
import {
  AdvanceRequestSchema,
  AttemptRequestSchema,
  CourseChatRequestSchema,
  CourseChatResponseSchema,
  CourseReleaseSchema,
  ExerciseSchema,
  StudyNotesRequestSchema,
  SessionResponseSchema,
} from '../src/course-api';

const source = {
  id: 'python-source',
  title: 'Python basics',
  body: 'Python evaluates expressions using operator precedence.',
  reference_urls: ['https://docs.python.org/3/tutorial/'],
};
const evidence = {
  id: 'precedence-evidence',
  source_id: source.id,
  locator: 'section 3.1',
  quote: 'operator precedence',
};
const objective = { id: 'expressions', title: 'Evaluate expressions', prerequisites: [] };
const exercise = (id: string, mode: 'practice' | 'checkpoint') => ({
  id,
  kind: 'choice',
  mode,
  prompt: 'What is evaluated first?',
  choices: [
    { id: 'multiply', label: 'Multiplication' },
    { id: 'add', label: 'Addition' },
  ],
  objective_ids: [objective.id],
  evidence_ids: [evidence.id],
  answer: 'multiply',
  explanation: 'Multiplication precedes addition.',
  hint: 'Compare the operator precedence.',
});
const release = () => ({
  id: 'c0378313-f11c-4a53-9bc6-71f2164873e7',
  course_id: 'c17b8873-f7d5-4cb4-9963-e638d328da0f',
  slug: 'python-foundations',
  title: 'Python Foundations',
  description: 'A short introduction to Python.',
  version: '1',
  size: 'mini',
  origin: 'prebuilt',
  visibility: 'catalog',
  status: 'published',
  user_id: null,
  estimated_minutes: 60,
  prerequisites: [],
  sources: [{ ...source, reference_urls: [...source.reference_urls] }],
  evidence: [{ ...evidence }],
  objectives: [{ ...objective, prerequisites: [...objective.prerequisites] }],
  modules: [{ id: 'core', title: 'Core', lesson_ids: ['expressions-lesson'] }],
  lessons: [
    {
      id: 'expressions-lesson',
      title: 'Expressions',
      objective_ids: [objective.id],
      blocks: [
        {
          id: 'explain',
          type: 'explanation',
          content: 'Python evaluates expressions using operator precedence.',
          language: null,
          evidence_ids: [evidence.id],
        },
      ],
      practice_ids: ['practice-1'],
      checkpoint_ids: ['checkpoint-1'],
    },
  ],
  exercises: [exercise('practice-1', 'practice'), exercise('checkpoint-1', 'checkpoint')],
});

describe('course wire contracts', () => {
  it('accepts a valid authored course with linked source evidence and grading keys', () => {
    expect(CourseReleaseSchema.parse(release())).toEqual(release());
  });

  it('rejects non-HTTP references, unowned private drafts and public private ownership', () => {
    expect(
      CourseReleaseSchema.safeParse({
        ...release(),
        sources: [{ ...source, reference_urls: ['file:///secret'] }],
      }).success,
    ).toBe(false);
    expect(CourseReleaseSchema.safeParse({ ...release(), visibility: 'private' }).success).toBe(false);
    expect(CourseReleaseSchema.safeParse({ ...release(), user_id: 'owner-id' }).success).toBe(false);
  });

  it('rejects invalid prerequisite graphs, unknown evidence and fabricated source quotes', () => {
    const cyclic = release();
    cyclic.objectives.push({ id: 'second', title: 'Second', prerequisites: ['expressions'] });
    cyclic.objectives[0]!.prerequisites = ['second'];
    expect(CourseReleaseSchema.safeParse(cyclic).success).toBe(false);

    const fabricated = release();
    fabricated.evidence[0]!.quote = 'This sentence is not in the source';
    expect(CourseReleaseSchema.safeParse(fabricated).success).toBe(false);

    const unlinked = release();
    unlinked.lessons[0]!.blocks[0]!.evidence_ids = ['missing'];
    expect(CourseReleaseSchema.safeParse(unlinked).success).toBe(false);
  });

  it('rejects mismatched module order, invalid exercise links and private grading fields in learner payloads', () => {
    const badModules = release();
    badModules.modules[0]!.lesson_ids = ['missing-lesson'];
    expect(CourseReleaseSchema.safeParse(badModules).success).toBe(false);

    const badExercise = release();
    badExercise.exercises[0]!.answer = 'missing-choice';
    expect(CourseReleaseSchema.safeParse(badExercise).success).toBe(false);

    const publicExercise = {
      id: 'checkpoint-1',
      kind: 'choice',
      mode: 'checkpoint',
      prompt: 'Choose an answer.',
      choices: [{ id: 'a', label: 'A' }],
      objective_ids: ['expressions'],
      evidence_ids: ['precedence-evidence'],
    };
    expect(ExerciseSchema.parse(publicExercise)).toEqual(publicExercise);
    expect(ExerciseSchema.safeParse({ ...publicExercise, answer: 'a' }).success).toBe(false);
  });

  it('validates owner-linked session locators, revision and idempotent attempt responses', () => {
    const session = {
      id: 'a0378313-f11c-4a53-9bc6-71f2164873e7',
      release_id: release().id,
      document_id: 'b0378313-f11c-4a53-9bc6-71f2164873e7',
      course_slug: 'python-foundations',
      course_title: 'Python Foundations',
      revision: 0,
      status: 'active',
      completed_lesson_ids: [],
      lessons: [
        {
          id: 'expressions-lesson',
          title: 'Expressions',
          completed: false,
          objective_ids: ['expressions-objective'],
          demonstrated_objective_ids: [],
        },
      ],
      lesson: {
        id: 'expressions-lesson',
        title: 'Expressions',
        objective_ids: ['expressions'],
        blocks: [release().lessons[0]!.blocks[0]!],
        practice: [
          {
            id: 'practice-1',
            kind: 'choice',
            mode: 'practice',
            prompt: 'What is evaluated first?',
            choices: [
              { id: 'multiply', label: 'Multiplication' },
              { id: 'add', label: 'Addition' },
            ],
            objective_ids: ['expressions'],
            evidence_ids: ['precedence-evidence'],
          },
        ],
        checkpoint: null,
      },
      evidence: [
        {
          ...evidence,
          document_id: 'b0378313-f11c-4a53-9bc6-71f2164873e7',
          chapter_id: 'c2378313-f11c-4a53-9bc6-71f2164873e7',
          chunk_id: 'd2378313-f11c-4a53-9bc6-71f2164873e7',
        },
      ],
      last_action: null,
      notes: [],
      bookmarks: [],
      conversation: [],
    };
    expect(SessionResponseSchema.parse(session)).toEqual(session);
    expect(
      SessionResponseSchema.safeParse({
        ...session,
        lesson: { ...session.lesson, checkpoint: exercise('key-leak', 'checkpoint') },
      }).success,
    ).toBe(false);
    expect(
      AttemptRequestSchema.safeParse({ id: session.id, revision: false, exercise_id: 'x', answer: 1 })
        .success,
    ).toBe(false);
  });

  it('validates bounded tutor questions and cited answer responses', () => {
    const id = 'a0378313-f11c-4a53-9bc6-71f2164873e7';
    expect(
      CourseChatRequestSchema.parse({ id, revision: 2, question: 'Why does multiplication run first?' }),
    ).toEqual({
      id,
      revision: 2,
      question: 'Why does multiplication run first?',
    });
    expect(CourseChatRequestSchema.safeParse({ id, revision: -1, question: 'x' }).success).toBe(false);
    expect(
      CourseChatResponseSchema.safeParse({
        id,
        question: 'Why?',
        answer: 'The lesson says multiplication precedes addition.',
        evidence_ids: ['precedence-evidence'],
        revision: 3,
        replayed: false,
      }).success,
    ).toBe(true);
  });

  it('validates revisioned continuation and owner-linked notes/bookmarks', () => {
    expect(AdvanceRequestSchema.parse({ revision: 2 })).toEqual({ revision: 2 });
    expect(AdvanceRequestSchema.safeParse({ revision: -1 }).success).toBe(false);
    expect(
      StudyNotesRequestSchema.safeParse({
        revision: 0,
        notes: [
          {
            id: 'a0378313-f11c-4a53-9bc6-71f2164873e7',
            lesson_id: 'expressions-lesson',
            text: 'Review precedence.',
          },
        ],
        bookmarks: [{ lesson_id: 'expressions-lesson', evidence_id: 'precedence-evidence' }],
      }).success,
    ).toBe(true);
  });
});
