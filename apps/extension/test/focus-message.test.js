import test from 'node:test';
import assert from 'node:assert/strict';
import { FOCUS_MESSAGE_TYPE, isFocusLocked, nextFocusLock, validateFocusMessage } from '../src/focus-message.js';

const NOW = Date.parse('2026-11-16T00:00:00.000Z');
const SESSION_A = '7504d84c-ec6a-4bd7-8cd6-3f69b3ea72c6';
const SESSION_B = '82d41738-671c-4329-bc66-73184775c150';

function activeMessage(sessionId = SESSION_A, expectedEndAt = '2026-11-16T01:00:00.000Z', sentAt = NOW) {
  return { type: FOCUS_MESSAGE_TYPE, version: 1, sessionId, active: true, expectedEndAt, sentAt };
}

test('validates versioned focus messages and rejects malformed or overlong sessions', () => {
  assert.equal(validateFocusMessage(activeMessage(), NOW)?.sessionId, SESSION_A);
  assert.equal(validateFocusMessage({ ...activeMessage(), version: 2 }, NOW), null);
  assert.equal(validateFocusMessage({ ...activeMessage(), sessionId: 'forged' }, NOW), null);
  assert.equal(validateFocusMessage(activeMessage(SESSION_A, '2026-11-16T05:00:00.000Z'), NOW), null);
  assert.equal(validateFocusMessage({ ...activeMessage(), active: false }, NOW), null);
  assert.equal(validateFocusMessage({ ...activeMessage(), sentAt: NOW + 31_000 }, NOW), null);
});

test('focus lock stays attached to its session and stale or mismatched end events cannot clear it', () => {
  const first = validateFocusMessage(activeMessage(), NOW);
  const second = validateFocusMessage(activeMessage(SESSION_B, '2026-11-16T02:00:00.000Z', NOW + 1_000), NOW);
  const lock = nextFocusLock(null, first, NOW);
  const newerLock = nextFocusLock(lock, second, NOW);
  assert.equal(newerLock?.sessionId, SESSION_A);
  const staleEnd = { ...first, active: false, expectedEndAt: null, sentAt: NOW - 1 };
  assert.equal(nextFocusLock(newerLock, staleEnd, NOW)?.sessionId, SESSION_A);
  const equalTimeEnd = { ...staleEnd, sentAt: newerLock.updatedAt };
  assert.equal(nextFocusLock(newerLock, equalTimeEnd, NOW)?.sessionId, SESSION_A);
  const unrelatedEnd = { ...staleEnd, sessionId: SESSION_B, sentAt: NOW + 2_000 };
  assert.equal(nextFocusLock(newerLock, unrelatedEnd, NOW)?.sessionId, SESSION_A);
  const sessionEnd = { ...staleEnd, sentAt: NOW + 3_000 };
  const cleared = nextFocusLock(newerLock, sessionEnd, NOW);
  assert.equal(cleared?.sessionId, null);
  assert.equal(nextFocusLock(cleared, first, NOW)?.sessionId, null);
  assert.equal(isFocusLocked(lock, NOW), true);
  assert.equal(isFocusLocked(lock, Date.parse('2026-11-16T01:00:00.000Z')), false);
});

test('a newer no-session snapshot clears an old lock and leaves a watermark against stale restores', () => {
  const lock = nextFocusLock(null, validateFocusMessage(activeMessage(), NOW), NOW);
  const noSession = validateFocusMessage({
    type: FOCUS_MESSAGE_TYPE,
    version: 1,
    sessionId: null,
    active: false,
    expectedEndAt: null,
    sentAt: NOW + 1_000,
  }, NOW);
  const cleared = nextFocusLock(lock, noSession, NOW);
  assert.equal(cleared?.sessionId, null);
  assert.equal(nextFocusLock(cleared, { ...noSession, active: true, sessionId: SESSION_B, expectedEndAt: '2026-11-16T02:00:00.000Z' }, NOW)?.sessionId, SESSION_B);
  assert.equal(nextFocusLock(cleared, validateFocusMessage(activeMessage(), NOW), NOW)?.sessionId, null);
});
