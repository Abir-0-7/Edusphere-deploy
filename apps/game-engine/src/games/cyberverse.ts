/** CYBERVERSE runs in Godot; this module supplies deterministic completion rules. */
export const CYBERVERSE_GAME_ID = 'cyberverse';

export const CYBERVERSE_MISSIONS = {
  binary_city: { name: 'Binary City', cost: 5, xp: 100, playable: true },
  code_district: { name: 'Code District', cost: 10, xp: 150, playable: false },
  network_nexus: { name: 'Network Nexus', cost: 15, xp: 200, playable: false },
  firewall_fortress: { name: 'Firewall Fortress', cost: 20, xp: 250, playable: false },
  algorithm_arena: { name: 'Algorithm Arena', cost: 25, xp: 300, playable: false },
  malware_core: { name: 'Malware Core', cost: 30, xp: 350, playable: false },
} as const;

export type CyberverseMissionId = keyof typeof CYBERVERSE_MISSIONS;
export const BINARY_CITY_CHALLENGE_VERSION = 'binary-v1';
export const BINARY_CITY_ANSWERS = [1, 2, 0, 3, 2, 0] as const;

export type CyberverseAction = {
  type: 'cyberverse_answer';
  missionId: CyberverseMissionId;
  challengeVersion: string;
  questionIndex: number;
  answer: number;
};

export function isCyberverseMission(value: unknown): value is CyberverseMissionId {
  return typeof value === 'string' && Object.hasOwn(CYBERVERSE_MISSIONS, value);
}

/** Validate the versioned evidence supplied by the existing Godot host bridge. */
export function validateCyberverseEvidence(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const evidence = value as { challengeVersion?: unknown; answers?: unknown };
  const answers = evidence.answers;
  return (
    evidence.challengeVersion === BINARY_CITY_CHALLENGE_VERSION &&
    Array.isArray(answers) &&
    answers.length === BINARY_CITY_ANSWERS.length &&
    BINARY_CITY_ANSWERS.every((answer, index) => answers[index] === answer)
  );
}

/** Replay one final successful attempt, without awarding or deducting tokens. */
export class Cyberverse {
  private nextQuestion = 0;
  private invalidAttempt = false;

  constructor(readonly missionId: CyberverseMissionId = 'binary_city') {}

  submit(action: CyberverseAction): boolean {
    if (this.invalidAttempt) return false;
    if (
      !action ||
      action.type !== 'cyberverse_answer' ||
      this.missionId !== 'binary_city' ||
      action.missionId !== this.missionId ||
      action.challengeVersion !== BINARY_CITY_CHALLENGE_VERSION ||
      action.questionIndex !== this.nextQuestion ||
      this.nextQuestion >= BINARY_CITY_ANSWERS.length ||
      action.answer !== BINARY_CITY_ANSWERS[this.nextQuestion]
    ) {
      this.invalidAttempt = true;
      return false;
    }
    this.nextQuestion++;
    return true;
  }

  get complete(): boolean {
    return (
      !this.invalidAttempt &&
      this.missionId === 'binary_city' &&
      this.nextQuestion === BINARY_CITY_ANSWERS.length
    );
  }

  get score(): number {
    return this.complete ? CYBERVERSE_MISSIONS.binary_city.xp : 0;
  }
}

/** Economy contract shared by the Game Vault host and the Godot bridge. */
export const CYBERVERSE_ECONOMY = {
  unlock: 'one_time',
  access: 'permanent',
  replayCost: 0,
  failedAttemptDeduction: 0,
  tokensAwardedOnCompletion: 0,
} as const;

export type CyberverseProgress = {
  tokens: number;
  xp: number;
  unlocked: readonly CyberverseMissionId[];
  completed: readonly CyberverseMissionId[];
};

export type CyberverseOutcome =
  | { ok: true; progress: CyberverseProgress; tokensSpent: number; xpAwarded: number; firstTime: boolean }
  | {
      ok: false;
      error:
        | 'mission_not_found'
        | 'insufficient_tokens'
        | 'mission_locked'
        | 'mission_not_playable'
        | 'completion_rejected';
      tokensSpent: 0;
      xpAwarded: 0;
    };

function reject(error: Extract<CyberverseOutcome, { ok: false }>['error']): CyberverseOutcome {
  return { ok: false, error, tokensSpent: 0, xpAwarded: 0 };
}

/** One-time redemption: owned missions are never charged again. */
export function applyCyberverseUnlock(progress: CyberverseProgress, missionId: string): CyberverseOutcome {
  if (!isCyberverseMission(missionId)) return reject('mission_not_found');
  if (progress.unlocked.includes(missionId)) {
    return { ok: true, progress, tokensSpent: 0, xpAwarded: 0, firstTime: false };
  }
  const cost = CYBERVERSE_MISSIONS[missionId].cost;
  if (progress.tokens < cost) return reject('insufficient_tokens');
  return {
    ok: true,
    tokensSpent: cost,
    xpAwarded: 0,
    firstTime: true,
    progress: { ...progress, tokens: progress.tokens - cost, unlocked: [...progress.unlocked, missionId] },
  };
}

/** XP only on the first verified completion; replays are free and failures cost nothing. */
export function applyCyberverseCompletion(
  progress: CyberverseProgress,
  missionId: string,
  actions: readonly CyberverseAction[],
): CyberverseOutcome {
  if (!isCyberverseMission(missionId)) return reject('mission_not_found');
  if (!progress.unlocked.includes(missionId)) return reject('mission_locked');
  if (!CYBERVERSE_MISSIONS[missionId].playable) return reject('mission_not_playable');
  const game = new Cyberverse(missionId);
  if (actions.length === 0 || !actions.every((action) => game.submit(action)) || !game.complete) {
    return reject('completion_rejected');
  }
  if (progress.completed.includes(missionId)) {
    return { ok: true, progress, tokensSpent: 0, xpAwarded: 0, firstTime: false };
  }
  const xp = CYBERVERSE_MISSIONS[missionId].xp;
  return {
    ok: true,
    tokensSpent: 0,
    xpAwarded: xp,
    firstTime: true,
    progress: { ...progress, xp: progress.xp + xp, completed: [...progress.completed, missionId] },
  };
}

/** Convert the Godot bridge's `{ challengeVersion, answers }` evidence into engine actions. */
export function cyberverseActionsFromEvidence(
  value: unknown,
  missionId: CyberverseMissionId = 'binary_city',
): CyberverseAction[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const evidence = value as { challengeVersion?: unknown; answers?: unknown };
  if (typeof evidence.challengeVersion !== 'string' || !Array.isArray(evidence.answers)) return [];
  if (evidence.answers.length > BINARY_CITY_ANSWERS.length) return [];
  const answers: unknown[] = Array.from(evidence.answers);
  if (!answers.every((answer) => Number.isInteger(answer))) return [];
  const challengeVersion = evidence.challengeVersion;
  return answers.map((answer, questionIndex) => ({
    type: 'cyberverse_answer',
    missionId,
    challengeVersion,
    questionIndex,
    answer: answer as number,
  }));
}
