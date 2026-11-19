import { describe, expect, it } from 'vitest';
import {
  QuizGradeRequestSchema,
  QuizGradeResultSchema,
  QuizSessionSchema,
} from '../src/flashcard-studio-api';

const session = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  document_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  deck_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  questions: [{
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    prompt: 'What is the source fact?',
    choices: [
      { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', text: 'The source fact.' },
      { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', text: 'A distractor.' },
    ],
  }],
};

describe('source quiz shared contracts', () => {
  it('accepts public quiz questions without keys and rejects private key fields', () => {
    expect(QuizSessionSchema.safeParse(session).success).toBe(true);
    expect(QuizSessionSchema.safeParse({ ...session, answer_key: { secret: 'value' } }).success).toBe(false);
    expect(QuizSessionSchema.safeParse({
      ...session,
      questions: [{ ...session.questions[0], correct_choice_id: session.questions[0]!.choices[0]!.id }],
    }).success).toBe(false);
  });

  it('rejects duplicate answers for one question', () => {
    const answer = { question_id: session.questions[0]!.id, choice_id: session.questions[0]!.choices[0]!.id };
    expect(QuizGradeRequestSchema.safeParse({ answers: [answer] }).success).toBe(true);
    expect(QuizGradeRequestSchema.safeParse({ answers: [answer, { ...answer, choice_id: session.questions[0]!.choices[1]!.id }] }).success).toBe(false);
  });

  it('validates post-grade source evidence feedback', () => {
    expect(QuizGradeResultSchema.safeParse({
      session_id: session.id,
      answered: 1,
      correct: 1,
      total: 1,
      percent: 100,
      feedback: [{
        question_id: session.questions[0]!.id,
        answered: true,
        correct: true,
        source_quote: 'Evidence from the original source.',
        page: 4,
      }],
    }).success).toBe(true);
  });
});
