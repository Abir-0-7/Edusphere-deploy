import {
  CYBERVERSE_BINARY_CITY_COST,
  CYBERVERSE_BINARY_CITY_XP,
  CYBERVERSE_GAME_ID,
} from '@studyvault/types';

export { CYBERVERSE_BINARY_CITY_COST, CYBERVERSE_BINARY_CITY_XP, CYBERVERSE_GAME_ID };

// Pinned from the existing Cyberverse Godot Binary City binary-v1 bridge. This
// verifies a final successful attempt; it never executes uploaded code or treats
// game XP as learning mastery. These keys are imported by server code only.
const BINARY_CITY_ANSWERS = [1, 2, 0, 3, 2, 0] as const;

export function validBinaryEvidence(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).sort().join('|') !== 'answers|challengeVersion') return false;
  const evidence = value as { challengeVersion: unknown; answers: unknown };
  const answers = evidence.answers;
  return (
    evidence.challengeVersion === 'binary-v1' &&
    Array.isArray(answers) &&
    answers.length === BINARY_CITY_ANSWERS.length &&
    BINARY_CITY_ANSWERS.every((answer, index) => answers[index] === answer)
  );
}
