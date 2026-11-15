export const FOCUS_MESSAGE_TYPE = 'studyvault.focus-session.v1';
export const MAX_FOCUS_SECONDS = 4 * 60 * 60;

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateFocusMessage(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.type !== FOCUS_MESSAGE_TYPE || value.version !== 1) return null;
  if (!Number.isSafeInteger(value.sentAt) || value.sentAt < 0 || value.sentAt > now + 30_000) return null;
  if (typeof value.active !== 'boolean') return null;

  if (!value.active) {
    if (value.expectedEndAt !== null) return null;
    if (value.sessionId !== null && (typeof value.sessionId !== 'string' || !SESSION_ID.test(value.sessionId))) return null;
    return {
      type: FOCUS_MESSAGE_TYPE,
      version: 1,
      sessionId: value.sessionId,
      active: false,
      expectedEndAt: null,
      sentAt: value.sentAt,
    };
  }

  if (typeof value.sessionId !== 'string' || !SESSION_ID.test(value.sessionId)) return null;
  if (typeof value.expectedEndAt !== 'string') return null;
  const expectedEnd = Date.parse(value.expectedEndAt);
  if (!Number.isFinite(expectedEnd) || expectedEnd <= now || expectedEnd > now + MAX_FOCUS_SECONDS * 1000) {
    return null;
  }

  return {
    type: FOCUS_MESSAGE_TYPE,
    version: 1,
    sessionId: value.sessionId,
    active: true,
    expectedEndAt: new Date(expectedEnd).toISOString(),
    sentAt: value.sentAt,
  };
}

export function isFocusLocked(lock, now = Date.now()) {
  if (!lock || typeof lock.sessionId !== 'string' || typeof lock.expectedEndAt !== 'string') return false;
  const expectedEnd = Date.parse(lock.expectedEndAt);
  return Number.isFinite(expectedEnd) && expectedEnd > now;
}

export function nextFocusLock(currentLock, message, now = Date.now()) {
  const updatedAt = Number.isSafeInteger(currentLock?.updatedAt) ? currentLock.updatedAt : 0;
  if (message.sentAt < updatedAt || (!message.active && message.sentAt === updatedAt)) return currentLock;

  if (message.active) {
    if (isFocusLocked(currentLock, now) && currentLock.sessionId !== message.sessionId) return currentLock;
    return { sessionId: message.sessionId, expectedEndAt: message.expectedEndAt, updatedAt: message.sentAt };
  }

  if (message.sessionId === null || currentLock?.sessionId === message.sessionId) {
    return { sessionId: null, expectedEndAt: null, updatedAt: message.sentAt };
  }
  return currentLock;
}
