import { describe, expect, it } from 'vitest';
import {
  AttemptRequestSchema,
  AssignmentDraftRequestSchema,
  AssignmentDraftResponseSchema,
  CourseAssignmentSchema,
  CourseChatRequestSchema,
  CourseChatResponseSchema,
  CourseReleaseSchema,
  CourseDetailSchema,
  ExerciseSchema,
  LabRunRequestSchema,
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
  labs: [],
  assignments: [],
  required_assignment_ids: [],
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
      adaptation: null,
      remediation: null,
      assignment_drafts: {},
      assignment_status: {},
      assignment_sections: {},
      assignment_evidence_ids: {},
      lab_progress: {},
      lab_transcripts: {},
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

  it('keeps authored lab targets private and validates owner-scoped assignment and lab writes', () => {
    const authored = CourseReleaseSchema.parse(release());
    authored.labs = [
      {
        id: 'read-only-sql',
        title: 'SQL practice',
        kind: 'sql_query',
        instructions: 'Write a read-only query.',
        workspace: 'products(id, price)',
        starter: 'SELECT id FROM products',
        tasks: [
          {
            id: 'task-1',
            title: 'Return IDs',
            prompt: 'Return every product id.',
            objective_ids: ['expressions'],
            evidence_ids: ['precedence-evidence'],
            expected_query: 'SELECT id FROM products',
            expected_output: 'id\n1',
          },
        ],
      },
    ];
    authored.assignments = [
      {
        id: 'report',
        title: 'Write a report',
        prompt: 'Explain your query.',
        deliverable: 'SQL plus explanation.',
        rubric: ['Uses SELECT.'],
        objective_ids: ['expressions'],
        evidence_ids: ['precedence-evidence'],
      },
    ];
    expect(CourseReleaseSchema.parse(authored).labs[0]?.tasks[0]?.expected_query).toBe(
      'SELECT id FROM products',
    );
    expect(
      CourseDetailSchema.safeParse({
        id: authored.course_id,
        release_id: authored.id,
        slug: authored.slug,
        title: authored.title,
        description: authored.description,
        version: authored.version,
        size: authored.size,
        origin: authored.origin,
        estimated_minutes: authored.estimated_minutes,
        lesson_count: 1,
        prerequisites: [],
        objectives: authored.objectives,
        lesson_titles: ['Expressions'],
        evidence: authored.evidence,
        reference_urls: [],
        prerequisite_met: true,
        modules: authored.modules,
        labs: [{ ...authored.labs[0], tasks: [{ ...authored.labs[0]!.tasks[0] }] }],
        assignments: authored.assignments,
      }).success,
    ).toBe(false);
    expect(
      AssignmentDraftRequestSchema.safeParse({
        id: 'a0378313-f11c-4a53-9bc6-71f2164873e7',
        revision: 1,
        assignment_id: 'report',
        action: 'submit',
        text: 'A short SQL response',
      }).success,
    ).toBe(true);
    expect(
      LabRunRequestSchema.safeParse({
        id: 'a0378313-f11c-4a53-9bc6-71f2164873e7',
        revision: 1,
        lab_id: 'read-only-sql',
        task_id: 'task-1',
        text: 'DROP TABLE products;',
      }).success,
    ).toBe(true);
  });
});

describe('structured capstones', () => {
  it('links a required structured capstone rubric and keeps legacy metadata defaults usable', () => {
    const assignment = CourseAssignmentSchema.parse({
      id: 'capstone',
      title: 'A supported design',
      prompt: 'Explain an algorithm.',
      deliverable: 'Written analysis.',
      rubric: ['Explain the reasoning.'],
      objective_ids: ['expressions'],
      evidence_ids: ['precedence-evidence'],
      criteria: [
        {
          id: 'reasoning',
          description: 'Explain your design.',
          objective_ids: ['expressions'],
          evidence_ids: ['precedence-evidence'],
          review_guidance: 'A human reviewer inspects this; no execution.',
        },
      ],
      sections: [
        { id: 'analysis', title: 'Analysis', prompt: 'Explain the design.', min_chars: 20, max_chars: 500 },
      ],
      require_evidence: true,
    });
    expect(
      CourseReleaseSchema.safeParse({
        ...release(),
        size: 'full',
        assignments: [assignment],
        required_assignment_ids: ['capstone'],
      }).success,
    ).toBe(true);
    expect(
      CourseReleaseSchema.safeParse({
        ...release(),
        assignments: [assignment],
        required_assignment_ids: ['missing'],
      }).success,
    ).toBe(false);
    expect(
      CourseAssignmentSchema.safeParse({
        ...assignment,
        criteria: [{ ...assignment.criteria[0]!, evidence_ids: ['forged'] }],
      }).success,
    ).toBe(false);
    expect(
      CourseAssignmentSchema.safeParse({
        ...assignment,
        sections: [assignment.sections[0], assignment.sections[0]],
      }).success,
    ).toBe(false);
    expect(CourseAssignmentSchema.safeParse({ ...assignment, require_evidence: 1 }).success).toBe(false);
    expect(
      CourseAssignmentSchema.safeParse({
        ...assignment,
        sections: [{ ...assignment.sections[0]!, min_chars: 501 }],
      }).success,
    ).toBe(false);
  });

  it('accepts bounded structured project work without inventing grades or execution claims', () => {
    const request = {
      id: 'a0378313-f11c-4a53-9bc6-71f2164873e7',
      revision: 2,
      assignment_id: 'capstone',
      action: 'submit',
      sections: { analysis: 'A supported algorithm and its assumptions.' },
      evidence_ids: ['precedence-evidence'],
    };
    expect(AssignmentDraftRequestSchema.parse(request).text).toBe('');
    expect(
      AssignmentDraftResponseSchema.parse({
        id: request.id,
        assignment_id: request.assignment_id,
        status: 'submitted',
        revision: 3,
        replayed: false,
        sections: request.sections,
        evidence_ids: request.evidence_ids,
      }).sections,
    ).toEqual(request.sections);
    expect(
      AssignmentDraftResponseSchema.safeParse({
        id: request.id,
        assignment_id: request.assignment_id,
        status: 'submitted',
        revision: 3,
        replayed: false,
        grade: 100,
      }).success,
    ).toBe(false);
    for (const change of [
      { sections: { analysis: 5 } },
      { sections: { analysis: 'x'.repeat(5001) } },
      { sections: { analysis: '\u0000' } },
      { sections: { analysis: '\ud800' } },
      {
        sections: Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [`s${index}`, 'x'.repeat(3000)]),
        ),
      },
      { evidence_ids: ['same', 'same'] },
      { score: 100 },
    ]) {
      expect(AssignmentDraftRequestSchema.safeParse({ ...request, ...change }).success).toBe(false);
    }
    expect(
      AssignmentDraftRequestSchema.safeParse({ ...request, sections: { analysis: '😀'.repeat(5000) } })
        .success,
    ).toBe(true);
  });
});
