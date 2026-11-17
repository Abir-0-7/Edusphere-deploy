import { describe, expect, it } from 'vitest';
import {
  BINARY_CITY_ANSWERS,
  BINARY_CITY_CHALLENGE_VERSION,
  CYBERVERSE_ECONOMY,
  CYBERVERSE_MISSIONS,
  Cyberverse,
  applyCyberverseCompletion,
  applyCyberverseUnlock,
  cyberverseActionsFromEvidence,
  isCyberverseMission,
  validateCompletion,
  validateCyberverseEvidence,
  type CyberverseAction,
  type CyberverseProgress,
  type GameAction,
} from './index';

function successfulAttempt(): CyberverseAction[] {
  return BINARY_CITY_ANSWERS.map((answer, questionIndex) => ({
    type: 'cyberverse_answer',
    missionId: 'binary_city',
    challengeVersion: BINARY_CITY_CHALLENGE_VERSION,
    questionIndex,
    answer,
  }));
}

describe('CYBERVERSE public registration', () => {
  it('publishes six mission prices and only the implemented mission as playable', () => {
    expect(Object.values(CYBERVERSE_MISSIONS).map((mission) => mission.cost)).toEqual([
      5, 10, 15, 20, 25, 30,
    ]);
    expect(
      Object.entries(CYBERVERSE_MISSIONS)
        .filter(([, mission]) => mission.playable)
        .map(([id]) => id),
    ).toEqual(['binary_city']);
    expect(isCyberverseMission('binary_city')).toBe(true);
    for (const id of ['constructor', '__proto__', 'unknown', null])
      expect(isCyberverseMission(id)).toBe(false);
  });

  it('replays the six correct answers with score 100 through both game IDs', () => {
    const game = new Cyberverse();
    expect(game.complete).toBe(false);
    expect(game.score).toBe(0);
    successfulAttempt().forEach((action) => expect(game.submit(action)).toBe(true));
    expect(game.complete).toBe(true);
    expect(game.score).toBe(100);
    for (const id of ['cyberverse', 'CYBERVERSE']) {
      expect(validateCompletion(id, successfulAttempt())).toEqual({ complete: true, score: 100 });
    }
  });

  it('rejects missing, incorrect, reordered, duplicate and extra answers', () => {
    const actions = successfulAttempt();
    const malformed: GameAction[][] = [
      [],
      actions.slice(0, 5),
      actions.slice(1),
      actions.map((action, index) => (index === 2 ? { ...action, answer: 1 } : action)),
      [...actions].reverse(),
      [actions[0]!, actions[0]!, ...actions.slice(1)],
      [...actions, actions[5]!],
      actions.map((action, index) => (index === 2 ? { ...action, questionIndex: 2.5 } : action)),
    ];
    for (const attempt of malformed) {
      expect(validateCompletion('cyberverse', attempt)).toEqual({ complete: false, score: 0 });
    }
  });

  it('rejects other versions, preview missions, and mixed game actions', () => {
    const actions = successfulAttempt();
    for (const missionId of [
      'code_district',
      'network_nexus',
      'firewall_fortress',
      'algorithm_arena',
      'malware_core',
    ] as const) {
      expect(
        validateCompletion(
          'cyberverse',
          actions.map((action) => ({ ...action, missionId })),
        ),
      ).toEqual({ complete: false, score: 0 });
      expect(new Cyberverse(missionId).submit({ ...actions[0]!, missionId })).toBe(false);
    }
    expect(
      validateCompletion(
        'cyberverse',
        actions.map((action) => ({ ...action, challengeVersion: 'unverified-v2' })),
      ),
    ).toEqual({ complete: false, score: 0 });
    expect(validateCompletion('cyberverse', [{ type: 'swap', left: 0, right: 1 }, ...actions])).toEqual({
      complete: false,
      score: 0,
    });
    expect(validateCompletion('SortingRace', actions)).toEqual({ complete: false, score: 0 });
    expect(validateCompletion('NQueens', actions)).toEqual({ complete: false, score: 0 });
    expect(validateCompletion('TowersOfHanoi', actions)).toEqual({ complete: false, score: 0 });
    expect(validateCompletion('FlashcardTowerDefense', actions)).toEqual({ complete: false, score: 0 });
  });

  it('does not recover a failed replay into a successful completion', () => {
    const game = new Cyberverse();
    expect(game.submit({ ...successfulAttempt()[0]!, answer: 0 })).toBe(false);
    successfulAttempt().forEach((action) => expect(game.submit(action)).toBe(false));
    expect(game.complete).toBe(false);
    expect(game.score).toBe(0);
  });
});

describe('CYBERVERSE bridge completion evidence', () => {
  it('accepts the existing Godot evidence contract', () => {
    expect(
      validateCyberverseEvidence({ challengeVersion: 'binary-v1', answers: [...BINARY_CITY_ANSWERS] }),
    ).toBe(true);
  });

  it('rejects forged, incomplete, wrong-type and sparse answer arrays', () => {
    const valid = { challengeVersion: 'binary-v1', answers: [...BINARY_CITY_ANSWERS] };
    for (const evidence of [
      null,
      [],
      {},
      { answers: valid.answers },
      { ...valid, challengeVersion: 'other' },
      { ...valid, answers: [] },
      { ...valid, answers: valid.answers.slice(0, 5) },
      { ...valid, answers: [1, 2, 0, 3, 2, 1] },
      { ...valid, answers: ['1', 2, 0, 3, 2, 0] },
      { ...valid, answers: [true, 2, 0, 3, 2, 0] },
      { ...valid, answers: new Array(6) },
      { ...valid, answers: [...valid.answers, 0] },
    ])
      expect(validateCyberverseEvidence(evidence)).toBe(false);
  });
});

describe('CYBERVERSE mission economy', () => {
  const fresh: CyberverseProgress = { tokens: 100, xp: 0, unlocked: [], completed: [] };
  const winningActions = () =>
    cyberverseActionsFromEvidence({
      challengeVersion: BINARY_CITY_CHALLENGE_VERSION,
      answers: [...BINARY_CITY_ANSWERS],
    });

  it('publishes the six-mission token / XP table and a zero-deduction contract', () => {
    expect(Object.entries(CYBERVERSE_MISSIONS).map(([id, m]) => [id, m.cost, m.xp])).toEqual([
      ['binary_city', 5, 100],
      ['code_district', 10, 150],
      ['network_nexus', 15, 200],
      ['firewall_fortress', 20, 250],
      ['algorithm_arena', 25, 300],
      ['malware_core', 30, 350],
    ]);
    expect(CYBERVERSE_ECONOMY).toMatchObject({
      unlock: 'one_time',
      access: 'permanent',
      replayCost: 0,
      failedAttemptDeduction: 0,
    });
  });

  it('charges each mission exactly once and keeps permanent access', () => {
    let progress: CyberverseProgress = { ...fresh, tokens: 105 };
    for (const id of Object.keys(CYBERVERSE_MISSIONS)) {
      const first = applyCyberverseUnlock(progress, id);
      expect(first.ok && first.tokensSpent).toBe(
        CYBERVERSE_MISSIONS[id as keyof typeof CYBERVERSE_MISSIONS].cost,
      );
      if (!first.ok) throw new Error('unlock failed');
      progress = first.progress;
      const again = applyCyberverseUnlock(progress, id);
      expect(again).toMatchObject({ ok: true, tokensSpent: 0, firstTime: false });
    }
    expect(progress.tokens).toBe(0);
    expect(progress.unlocked).toHaveLength(6);
  });

  it('rejects unknown missions and insufficient balances without spending', () => {
    expect(applyCyberverseUnlock(fresh, '__proto__')).toMatchObject({
      ok: false,
      error: 'mission_not_found',
      tokensSpent: 0,
    });
    expect(applyCyberverseUnlock({ ...fresh, tokens: 29 }, 'malware_core')).toMatchObject({
      ok: false,
      error: 'insufficient_tokens',
      tokensSpent: 0,
    });
  });

  it('awards XP once, replays free, and failed attempts deduct nothing', () => {
    const unlocked = applyCyberverseUnlock(fresh, 'binary_city');
    if (!unlocked.ok) throw new Error('unlock failed');
    const failed = applyCyberverseCompletion(
      unlocked.progress,
      'binary_city',
      cyberverseActionsFromEvidence({ challengeVersion: 'binary-v1', answers: [1, 2, 0, 3, 2, 1] }),
    );
    expect(failed).toMatchObject({ ok: false, error: 'completion_rejected', tokensSpent: 0, xpAwarded: 0 });
    const first = applyCyberverseCompletion(unlocked.progress, 'binary_city', winningActions());
    expect(first).toMatchObject({ ok: true, xpAwarded: 100, tokensSpent: 0, firstTime: true });
    if (!first.ok) throw new Error('completion failed');
    expect(first.progress.tokens).toBe(95);
    const replay = applyCyberverseCompletion(first.progress, 'binary_city', winningActions());
    expect(replay).toMatchObject({ ok: true, xpAwarded: 0, tokensSpent: 0, firstTime: false });
    if (replay.ok) expect(replay.progress).toEqual(first.progress);
  });

  it('requires ownership and a playable mission before completion', () => {
    expect(applyCyberverseCompletion(fresh, 'binary_city', winningActions())).toMatchObject({
      ok: false,
      error: 'mission_locked',
    });
    const owned = applyCyberverseUnlock(fresh, 'code_district');
    if (!owned.ok) throw new Error('unlock failed');
    expect(applyCyberverseCompletion(owned.progress, 'code_district', winningActions())).toMatchObject({
      ok: false,
      error: 'mission_not_playable',
    });
  });

  it('maps bridge evidence into GameActions accepted by validateCompletion', () => {
    expect(validateCompletion('cyberverse', winningActions())).toEqual({ complete: true, score: 100 });
    for (const bad of [
      null,
      [],
      { answers: [1] },
      { challengeVersion: 'binary-v1', answers: new Array(6) },
      { challengeVersion: 'binary-v1', answers: [1, 2, 0, 3, 2, 0, 1] },
    ]) {
      expect(cyberverseActionsFromEvidence(bad)).toEqual([]);
    }
  });
});
