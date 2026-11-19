import { describe, expect, it } from 'vitest';
import {
  LearnerDiagnosticDefinitionSchema,
  LearnerDiagnosticRequestSchema,
  LearnerDiagnosticSummarySchema,
  LearnerProfileInputSchema,
  LearnerProfileResponseSchema,
} from '../src/learner-profile-api';

const preferences = {
  goal_kind: 'career',
  goal: 'Learn Python for data analysis',
  familiarity: 'new',
  weekly_minutes: 120,
  deadline: null,
  language: 'en',
  accessibility: { reduced_motion: false, larger_text: false, text_alternative: true },
};
const summary = {
  version: 'python-foundations-v1',
  status: 'not_started',
  skills: [
    { skill_id: 'python-expressions', state: 'unknown' },
    { skill_id: 'python-loops', state: 'unknown' },
    { skill_id: 'python-functions', state: 'unknown' },
  ],
  completed_at: null,
};
const diagnostic = {
  version: 'python-foundations-v1',
  action: 'complete',
  answers: [{ question_id: 'expressions', choice_id: 'a' }],
};

describe('learner-profile contracts', () => {
  it('accepts novice, experienced and uncertain self-reports without assessment claims', () => {
    for (const familiarity of ['new', 'some', 'experienced', 'unsure']) {
      expect(LearnerProfileInputSchema.parse({ ...preferences, familiarity }).familiarity).toBe(familiarity);
    }
    const academic = LearnerProfileInputSchema.parse({
      ...preferences,
      goal_kind: 'academic',
      goal: '  পরীক্ষার প্রস্তুতি  ',
      language: 'bn',
      deadline: '2028-02-29',
    });
    expect(academic.goal).toBe('পরীক্ষার প্রস্তুতি');
    expect(academic.deadline).toBe('2028-02-29');
  });

  it('requires bounded weekly minutes and a nonempty bounded goal', () => {
    for (const weekly_minutes of [true, '120', 14, 10081, 60.5, null, Infinity]) {
      expect(LearnerProfileInputSchema.safeParse({ ...preferences, weekly_minutes }).success).toBe(false);
    }
    for (const weekly_minutes of [15, 10080]) {
      expect(LearnerProfileInputSchema.safeParse({ ...preferences, weekly_minutes }).success).toBe(true);
    }
    for (const goal of ['', '  ', 'x'.repeat(201)]) {
      expect(LearnerProfileInputSchema.safeParse({ ...preferences, goal }).success).toBe(false);
    }
  });

  it('rejects malformed dates, undeclared languages and coerced accessibility flags', () => {
    for (const deadline of ['2026-02-29', '2026-02-30', '20261118', '2026-11-18T00:00:00Z', 123]) {
      expect(LearnerProfileInputSchema.safeParse({ ...preferences, deadline }).success).toBe(false);
    }
    expect(LearnerProfileInputSchema.safeParse({ ...preferences, language: 'fr' }).success).toBe(false);
    expect(
      LearnerProfileInputSchema.safeParse({
        ...preferences,
        accessibility: { ...preferences.accessibility, reduced_motion: 'false' },
      }).success,
    ).toBe(false);
    const missingDeadline: Partial<typeof preferences> = { ...preferences };
    delete missingDeadline.deadline;
    expect(LearnerProfileInputSchema.safeParse(missingDeadline).success).toBe(false);
  });

  it('rejects ownership, diagnostic and mastery fields in preference writes', () => {
    for (const extra of [
      { user_id: 'other-user' },
      { mastery: 100 },
      { diagnostic: summary },
      { updated_at: '2026-11-18T00:00:00Z' },
    ]) {
      expect(LearnerProfileInputSchema.safeParse({ ...preferences, ...extra }).success).toBe(false);
    }
    expect(
      LearnerProfileInputSchema.safeParse({
        ...preferences,
        accessibility: { ...preferences.accessibility, inferred_disability: true },
      }).success,
    ).toBe(false);
  });

  it('preserves unknown-skill summaries and accepts saved offset timestamps', () => {
    expect(LearnerProfileResponseSchema.parse({ profile: null })).toEqual({ profile: null });
    for (const status of ['not_started', 'skipped', 'completed']) {
      const response = {
        profile: {
          ...preferences,
          role_variant: 'auto',
          explanation_depth: 'standard',
          pace: 'standard',
          diagnostic: { ...summary, status },
          updated_at: '2026-11-18T13:00:00+06:00',
        },
      };
      expect(LearnerProfileResponseSchema.parse(response)).toEqual(response);
    }
    expect(
      LearnerDiagnosticSummarySchema.safeParse({
        ...summary,
        skills: [{ skill_id: 'python-loops', state: 'mastered' }],
      }).success,
    ).toBe(false);
    expect(
      LearnerDiagnosticSummarySchema.safeParse({ ...summary, completed_at: '2026-11-18T12:00:00' }).success,
    ).toBe(false);
  });

  it('accepts partial diagnostic answers and explicit skips', () => {
    expect(LearnerDiagnosticRequestSchema.parse(diagnostic)).toEqual(diagnostic);
    const partial = {
      ...diagnostic,
      answers: [...diagnostic.answers, { question_id: 'loops', choice_id: null }],
    };
    expect(LearnerDiagnosticRequestSchema.parse(partial)).toEqual(partial);
    expect(
      LearnerDiagnosticRequestSchema.parse({
        version: 'python-foundations-v1',
        action: 'skip',
        answers: [],
      }).action,
    ).toBe('skip');
  });

  it('rejects duplicate answers, empty completions, answered skips and untrusted results', () => {
    for (const request of [
      { ...diagnostic, answers: [diagnostic.answers[0], diagnostic.answers[0]] },
      { ...diagnostic, answers: [] },
      { ...diagnostic, answers: [{ question_id: 'loops', choice_id: null }] },
      { ...diagnostic, action: 'skip' },
      { ...diagnostic, version: 'python-foundations-v2' },
      { ...diagnostic, score: 3 },
      { ...diagnostic, answers: [{ ...diagnostic.answers[0], correct: true }] },
      {
        ...diagnostic,
        answers: ['one', 'two', 'three', 'four'].map((question_id) => ({ question_id, choice_id: 'a' })),
      },
    ]) {
      expect(LearnerDiagnosticRequestSchema.safeParse(request).success).toBe(false);
    }
  });

  it('requires exactly three public questions and excludes server answer keys', () => {
    const definition = {
      version: 'python-foundations-v1',
      title: 'Optional Python starting check',
      description: 'A starting signal, not mastery.',
      questions: ['python-expressions', 'python-loops', 'python-functions'].map((skill_id) => ({
        id: skill_id,
        skill_id,
        prompt: 'Read this example.',
        choices: ['a', 'b', 'c'].map((id) => ({ id, label: id })),
      })),
    };
    expect(LearnerDiagnosticDefinitionSchema.parse(definition)).toEqual(definition);
    expect(LearnerDiagnosticDefinitionSchema.safeParse({ ...definition, questions: [] }).success).toBe(false);
    expect(
      LearnerDiagnosticDefinitionSchema.safeParse({
        ...definition,
        questions: definition.questions.map((question) => ({ ...question, answer: 'a' })),
      }).success,
    ).toBe(false);
  });
});
