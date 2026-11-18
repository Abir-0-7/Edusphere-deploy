import { describe, expect, it } from 'vitest';
import {
  applyGame,
  createGame,
  getGameResult,
  getPublicQuestion,
  restoreGame,
  serializeGame,
} from './session';
import { questionsFor } from './content';

const config = (
  game_id:
    | 'SortingRace'
    | 'NQueens'
    | 'TowersOfHanoi'
    | 'FlashcardTowerDefense'
    | 'ConceptMatch'
    | 'RetrievalSprint'
    | 'CodeTrace',
  practice = false,
) => ({ version: 1 as const, game_id, difficulty: 'easy' as const, seed: 17, practice });

describe('versioned game sessions', () => {
  it('replays an identical sorted session and rejects sequence gaps', () => {
    let state = createGame(config('SortingRace'));
    const target = [...state.values].sort((a, b) => a - b);
    for (let i = 0; i < target.length; i++) {
      if (getGameResult(state).status === 'won') break;
      const index = state.values.indexOf(target[i]!, i);
      if (index !== i) {
        state = applyGame(state, {
          seq: state.actions.length + 1,
          action: { type: 'swap', left: i, right: index },
        });
      }
    }
    expect(getGameResult(state).status).toBe('won');
    expect(restoreGame(serializeGame(state)).values).toEqual(state.values);
    expect(() =>
      applyGame(createGame(config('SortingRace')), { seq: 2, action: { type: 'swap', left: 0, right: 1 } }),
    ).toThrow();
  });

  it('keeps question keys server-side while returning source-linked choices', () => {
    const state = createGame(config('CodeTrace'));
    const question = getPublicQuestion(state);
    expect(question?.id).toBeTruthy();
    expect(question?.source.url).toMatch(/^https:\/\/docs\.python\.org/);
    const next = applyGame(state, {
      seq: 1,
      action: { type: 'answer', question_id: question!.id, choice: 0 },
    });
    expect(next.feedback?.question_id).toBe(question?.id);
    expect(next.actions[0]?.action).toEqual({ type: 'answer', question_id: question?.id, choice: 0 });
  });

  it('permits practice hints and undo without rewarding the session', () => {
    let state = createGame(config('SortingRace', true));
    state = applyGame(state, { seq: 1, action: { type: 'hint' } });
    const before = [...state.values];
    state = applyGame(state, { seq: 2, action: { type: 'swap', left: 0, right: 1 } });
    state = applyGame(state, { seq: 3, action: { type: 'undo' } });
    expect(state.values).toEqual(before);
    expect(getGameResult(state).rewardEligible).toBe(false);
  });

  it('rejects movement actions for question games and out-of-order answers', () => {
    const state = createGame(config('ConceptMatch'));
    expect(() => applyGame(state, { seq: 1, action: { type: 'move', from: 0, to: 1 } })).toThrow();
    const q = getPublicQuestion(state)!;
    expect(() =>
      applyGame(state, { seq: 1, action: { type: 'answer', question_id: 'other', choice: 0 } }),
    ).toThrow();
    expect(q.choices.length).toBeGreaterThan(1);
  });

  it('scopes prepared questions to one approved objective without changing grading keys', () => {
    let state = createGame({ ...config('CodeTrace'), objective_id: 'python.arithmetic' });
    let count = 0;
    while (getPublicQuestion(state)) {
      const question = getPublicQuestion(state)!;
      expect(question.prompt).toContain('Predict the output');
      const key = questionsFor(state.config).find((item) => item.id === question.id)!.answer;
      state = applyGame(state, {
        seq: state.actions.length + 1,
        action: { type: 'answer', question_id: question.id, choice: key },
      });
      count++;
    }
    expect(count).toBeGreaterThan(0);
    expect(getGameResult(state).status).toBe('won');
  });

  for (const game_id of ['ConceptMatch', 'RetrievalSprint', 'FlashcardTowerDefense', 'CodeTrace'] as const) {
    for (const objective_id of [
      'python.arithmetic',
      'python.collections',
      'python.iteration',
      'python.branching',
    ] as const) {
      it(`starts, grades and restores nonempty ${game_id}/${objective_id} content`, () => {
        let state = createGame({ ...config(game_id), objective_id });
        expect(getGameResult(state).status).toBe('playing');
        expect(getPublicQuestion(state)).not.toBeNull();
        const prepared = questionsFor(state.config);
        expect(prepared.length).toBeGreaterThan(0);
        expect(prepared.every((question) => question.objective_id === objective_id)).toBe(true);
        for (const question of prepared) {
          expect(getPublicQuestion(state)?.id).toBe(question.id);
          state = applyGame(state, {
            seq: state.actions.length + 1,
            action: { type: 'answer', question_id: question.id, choice: question.answer },
          });
          expect(restoreGame(serializeGame(state))).toEqual(state);
        }
        expect(getGameResult(state)).toMatchObject({ status: 'won', rewardEligible: true });
        expect(getPublicQuestion(state)).toBeNull();
      });
    }
  }

  it('rejects unsupported puzzle scopes and empty question scopes before creating a game', () => {
    expect(() => createGame({ ...config('NQueens'), objective_id: 'python.branching' })).toThrow('scope');
    expect(() => questionsFor({ ...config('ConceptMatch'), objective_id: 'python.unknown' })).toThrow(
      'no questions',
    );
    expect(() => questionsFor({ ...config('ConceptMatch'), objective_id: '' })).toThrow('no questions');
  });

  it('never rewards an all-incorrect short objective session and rejects terminal extensions', () => {
    let state = createGame({ ...config('RetrievalSprint'), objective_id: 'python.branching' });
    const question = questionsFor(state.config)[0]!;
    state = applyGame(state, {
      seq: 1,
      action: {
        type: 'answer',
        question_id: question.id,
        choice: (question.answer + 1) % question.choices.length,
      },
    });
    expect(getGameResult(state)).toMatchObject({ status: 'lost', rewardEligible: false });
    expect(() =>
      applyGame(state, {
        seq: 2,
        action: { type: 'answer', question_id: question.id, choice: question.answer },
      }),
    ).toThrow('already complete');
    const bad = serializeGame(state);
    bad.actions.push({
      seq: 2,
      action: { type: 'answer', question_id: question.id, choice: question.answer },
    });
    expect(() => restoreGame(bad)).toThrow('after completion');
  });

  it('uses the exact rounded 60% boundary across short scopes and all difficulties', () => {
    for (const game_id of [
      'ConceptMatch',
      'RetrievalSprint',
      'FlashcardTowerDefense',
      'CodeTrace',
    ] as const) {
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        for (const objective_id of [
          undefined,
          'python.arithmetic',
          'python.branching',
          'python.collections',
        ] as const) {
          const input = { ...config(game_id), difficulty, ...(objective_id ? { objective_id } : {}) };
          const prepared = questionsFor(input);
          const threshold = Math.ceil(prepared.length * 0.6);
          for (const successes of [threshold - 1, threshold]) {
            let state = createGame(input);
            for (
              let index = 0;
              index < prepared.length && getGameResult(state).status === 'playing';
              index++
            ) {
              const question = prepared[index]!;
              const choice =
                index < successes ? question.answer : (question.answer + 1) % question.choices.length;
              state = applyGame(state, {
                seq: state.actions.length + 1,
                action: { type: 'answer', question_id: question.id, choice },
              });
            }
            expect(
              getGameResult(state).status,
              `${game_id}/${difficulty}/${objective_id ?? 'all'} at ${successes}/${prepared.length}`,
            ).toBe(successes >= threshold ? 'won' : 'lost');
            expect(getGameResult(state).explanation).toContain(`${threshold} of ${prepared.length}`);
            expect(getPublicQuestion(state)).toBeNull();
          }
        }
      }
    }
  });
});
