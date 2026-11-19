import { describe, expect, it } from 'vitest';
import { GameCommandInputSchema, GameCreateInputSchema, GamePublicViewSchema } from '@studyvault/types';
import {
  createGame,
  applyGame,
  getAuthoredQuestion,
  getPublicQuestion,
  getGameResult,
  serializeGame,
  restoreGame,
  type GameState,
  type GameAction,
} from './session';
import { questionsFor } from './content';

const NEW_GAMES = [
  'DebuggingDetective',
  'SQLDetective',
  'GraphPath',
  'ProofBuilder',
  'DataDetective',
  'AdaptiveQuiz',
  'ExamEscape',
] as const;
const input = (
  game_id: (typeof NEW_GAMES)[number],
  difficulty: 'easy' | 'medium' | 'hard' = 'easy',
  practice = false,
) => ({ version: 1 as const, game_id, difficulty, practice, seed: 29 });
function correctAction(state: GameState): GameAction {
  const q = getAuthoredQuestion(state)!;
  if (q.activity?.kind === 'debug')
    return { type: 'debug', question_id: q.id, line: q.solution!.line!, repair: q.solution!.repair! };
  if (q.activity?.kind === 'graph')
    return { type: 'path', question_id: q.id, node_ids: [...q.solution!.node_ids!] };
  if (q.activity?.kind === 'proof')
    return { type: 'order', question_id: q.id, step_ids: [...q.solution!.step_ids!] };
  return { type: 'answer', question_id: q.id, choice: q.answer };
}
const act = (state: GameState, action: GameAction) =>
  applyGame(state, { seq: state.actions.length + 1, action });

describe('expanded deterministic games', () => {
  for (const id of NEW_GAMES)
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      it(`${id}/${difficulty} completes, validates public payload, and restores after every action`, () => {
        let state = createGame(input(id, difficulty));
        while (getGameResult(state).status === 'playing') {
          const publicQuestion = getPublicQuestion(state)!;
          expect(publicQuestion.activity).toBeDefined();
          expect(publicQuestion.progress!.current).toBeGreaterThan(0);
          expect(publicQuestion).not.toHaveProperty('answer');
          expect(publicQuestion).not.toHaveProperty('solution');
          expect(JSON.stringify(publicQuestion)).not.toContain('dependencies');
          expect(GamePublicViewSchema.shape.question.safeParse(publicQuestion).success).toBe(true);
          const action = correctAction(state);
          expect(
            GameCommandInputSchema.safeParse({
              revision: 0,
              command: 'act',
              action: { seq: state.actions.length + 1, action },
            }).success,
          ).toBe(true);
          state = act(state, action);
          expect(restoreGame(serializeGame(state))).toEqual(state);
          expect(state.actions.length).toBeLessThan(9);
        }
        expect(getGameResult(state)).toMatchObject({ status: 'won', rewardEligible: true });
        expect(getPublicQuestion(state)).toBeNull();
        expect(() => act(state, correctAction(createGame(input(id, difficulty))))).toThrow(
          'already complete',
        );
      });
      it(`${id}/${difficulty} preserves practice undo and withholds rewards`, () => {
        let state = createGame(input(id, difficulty, true));
        const first = getPublicQuestion(state);
        state = act(state, { type: 'hint' });
        expect(state.hints).toBe(1);
        state = act(state, correctAction(state));
        state = act(state, { type: 'undo' });
        expect(getPublicQuestion(state)).toEqual(first);
        while (getGameResult(state).status === 'playing') state = act(state, correctAction(state));
        expect(getGameResult(state)).toMatchObject({ status: 'won', rewardEligible: false });
      });
    }

  for (const id of NEW_GAMES)
    it(`${id} rejects unsupported objective scopes`, () => {
      expect(GameCreateInputSchema.safeParse({ game_id: id, objective_id: 'python.branching' }).success).toBe(
        false,
      );
      expect(() => createGame({ ...input(id), objective_id: 'python.branching' })).toThrow('scope');
    });

  for (const id of NEW_GAMES)
    it(`${id} loses after three valid incorrect attempts without granting a reward`, () => {
      let state = createGame(input(id));
      while (getGameResult(state).status === 'playing') {
        const q = getAuthoredQuestion(state)!;
        const good = correctAction(state);
        let wrong: GameAction;
        if (good.type === 'debug') wrong = { ...good, line: good.line === 0 ? 1 : 0 };
        else if (good.type === 'path')
          wrong = {
            ...good,
            node_ids:
              good.node_ids.length === 0 ? [q.activity?.kind === 'graph' ? q.activity.start : 'A'] : [],
          };
        else if (good.type === 'order') wrong = { ...good, step_ids: [...good.step_ids].reverse() };
        else wrong = { type: 'answer', question_id: q.id, choice: (q.answer + 1) % q.choices.length };
        state = act(state, wrong);
        expect(state.feedback?.correct).toBe(false);
        expect(restoreGame(serializeGame(state))).toEqual(state);
      }
      expect(state.mistakes).toBe(3);
      expect(getGameResult(state)).toMatchObject({ status: 'lost', rewardEligible: false });
    });

  it('grades faulty line and repair together, and rejects generic answer bypasses', () => {
    const state = createGame(input('DebuggingDetective'));
    const q = getAuthoredQuestion(state)!;
    expect(() => act(state, { type: 'answer', question_id: q.id, choice: 0 })).toThrow('game-specific');
    const wrong = act(state, {
      type: 'debug',
      question_id: q.id,
      line: q.solution!.line === 0 ? 1 : 0,
      repair: q.solution!.repair!,
    });
    expect(wrong.mistakes).toBe(1);
    expect(() => act(state, { type: 'debug', question_id: q.id, line: 15, repair: 15 })).toThrow('not valid');
  });

  function stateWithQuestion(id: 'GraphPath' | 'ProofBuilder', questionId: string) {
    for (let seed = 0; seed < 200; seed++) {
      const state = createGame({ ...input(id), seed });
      if (getPublicQuestion(state)?.id === questionId) return state;
    }
    throw new Error('test fixture seed not found');
  }
  it('accepts both shortest tied routes and rejects a disconnected false route', () => {
    const state = stateWithQuestion('GraphPath', 'graph-1');
    for (const node_ids of [
      ['A', 'B', 'D'],
      ['A', 'C', 'D'],
    ])
      expect(act(state, { type: 'path', question_id: 'graph-1', node_ids }).feedback?.correct).toBe(true);
    const disconnected = stateWithQuestion('GraphPath', 'graph-3');
    expect(act(disconnected, { type: 'path', question_id: 'graph-3', node_ids: [] }).feedback?.correct).toBe(
      true,
    );
    expect(
      act(disconnected, { type: 'path', question_id: 'graph-3', node_ids: ['A', 'D'] }).feedback?.correct,
    ).toBe(false);
    expect(() => act(state, { type: 'path', question_id: 'graph-1', node_ids: ['A', 'A', 'D'] })).toThrow();
    expect(() => act(state, { type: 'path', question_id: 'graph-1', node_ids: ['A', 'X', 'D'] })).toThrow(
      'unknown',
    );
    expect(() => act(state, { type: 'answer', question_id: 'graph-1', choice: 0 })).toThrow('game-specific');
  });
  it('accepts equivalent independent proof orders but rejects a conclusion before its facts', () => {
    const state = stateWithQuestion('ProofBuilder', 'proof-1');
    for (const step_ids of [
      ['s1', 's2', 's3', 's4'],
      ['s2', 's1', 's3', 's4'],
    ])
      expect(act(state, { type: 'order', question_id: 'proof-1', step_ids }).feedback?.correct).toBe(true);
    expect(
      act(state, { type: 'order', question_id: 'proof-1', step_ids: ['s4', 's1', 's2', 's3'] }).feedback
        ?.correct,
    ).toBe(false);
    expect(() =>
      act(state, { type: 'order', question_id: 'proof-1', step_ids: ['s1', 's1', 's3', 's4'] }),
    ).toThrow();
    expect(() => act(state, { type: 'answer', question_id: 'proof-1', choice: 0 })).toThrow('game-specific');
  });
  it('adapts deterministically, explains the rule and never repeats a question', () => {
    let state = createGame(input('AdaptiveQuiz'));
    const seen = new Set<string>();
    while (getGameResult(state).status === 'playing') {
      const q = getPublicQuestion(state)!;
      expect(seen.has(q.id)).toBe(false);
      seen.add(q.id);
      expect(q.activity?.kind).toBe('adaptive');
      expect(state.adaptiveLevel).toBe(
        state.questionIndex === 0 ? 'easy' : state.questionIndex === 1 ? 'medium' : 'hard',
      );
      state = act(state, correctAction(state));
    }
    let easier = createGame(input('AdaptiveQuiz', 'hard'));
    const q = getAuthoredQuestion(easier)!;
    easier = act(easier, { type: 'answer', question_id: q.id, choice: (q.answer + 1) % q.choices.length });
    expect(easier.adaptiveLevel).toBe('medium');
    expect(getPublicQuestion(easier)?.activity).toMatchObject({ kind: 'adaptive', level: 'medium' });
    expect(getGameResult(easier).explanation).toContain('not mastery');
  });
  it('keeps an escape lock shut until correct and loses after three untimed wrong attempts', () => {
    let state = createGame(input('ExamEscape'));
    const first = getAuthoredQuestion(state)!;
    const saved = serializeGame(state);
    expect(restoreGame(saved)).toEqual(state);
    for (let count = 0; count < 3; count++) {
      state = act(state, {
        type: 'answer',
        question_id: first.id,
        choice: (first.answer + 1) % first.choices.length,
      });
      expect(state.questionIndex).toBe(0);
      expect(state.mistakes).toBe(count + 1);
    }
    expect(getGameResult(state)).toMatchObject({ status: 'lost', rewardEligible: false });
    expect(getGameResult(state).explanation).toContain('Unlock all');
  });
  it('uses bounded diverse fixtures and keeps generic new question choices seeded', () => {
    for (const id of NEW_GAMES) {
      const prepared = questionsFor(input(id, 'hard'));
      expect(prepared).toHaveLength(7);
      expect(new Set(prepared.map((q) => q.id)).size).toBe(7);
      expect(prepared).toEqual(questionsFor(input(id, 'hard')));
    }
    expect(new Set(questionsFor(input('SQLDetective', 'hard')).map((q) => q.answer)).size).toBeGreaterThan(1);
  });
});
