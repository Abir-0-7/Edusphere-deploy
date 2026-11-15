import { createBlockingRules, MAX_BLOCKED_DOMAINS, normalizeBlocklist, normalizeDomain, OWN_RULE_ID_START } from './rules.js';
import { isFocusLocked, nextFocusLock, validateFocusMessage } from './focus-message.js';
import { isAllowedWebOrigin } from './origin-config.js';

const STORAGE_KEY = 'studyvaultFocusState';
const ALARM_NAME = 'studyvault-focus-expiry';
const OWN_RULE_ID_END = OWN_RULE_ID_START + MAX_BLOCKED_DOMAINS;
let operationQueue = Promise.resolve();

function serialize(operation) {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.catch(() => undefined);
  return result;
}

async function readState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  const candidateLock = value?.focusLock;
  const focusLock =
    candidateLock &&
    (candidateLock.sessionId === null || typeof candidateLock.sessionId === 'string') &&
    (candidateLock.expectedEndAt === null || typeof candidateLock.expectedEndAt === 'string') &&
    Number.isSafeInteger(candidateLock.updatedAt)
      ? candidateLock
      : null;
  return {
    blocklist: normalizeBlocklist(value?.blocklist),
    focusLock,
  };
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function applyRules(blocklist) {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = rules
    .filter((rule) => rule.id >= OWN_RULE_ID_START && rule.id < OWN_RULE_ID_END)
    .map((rule) => rule.id);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: createBlockingRules(blocklist),
  });
}

async function reconcile() {
  return serialize(async () => {
    const state = await readState();
    const locked = isFocusLocked(state.focusLock);
    await applyRules(locked ? state.blocklist : []);
    if (locked) {
      await chrome.alarms.create(ALARM_NAME, { when: Date.parse(state.focusLock.expectedEndAt) });
    } else {
      await chrome.alarms.clear(ALARM_NAME);
    }
    await saveState(state);
  });
}

async function handleFocusMessage(rawMessage) {
  const message = validateFocusMessage(rawMessage);
  if (!message) return { ok: false, error: 'invalid-message' };

  return serialize(async () => {
    const state = await readState();
    const currentLock = state.focusLock;
    if (message.active && isFocusLocked(currentLock) && currentLock.sessionId !== message.sessionId) {
      return { ok: false, error: 'another-session-is-active' };
    }
    const focusLock = nextFocusLock(currentLock, message);
    await applyRules(isFocusLocked(focusLock) ? state.blocklist : []);
    await saveState({ ...state, focusLock });
    if (isFocusLocked(focusLock)) {
      await chrome.alarms.create(ALARM_NAME, { when: Date.parse(focusLock.expectedEndAt) });
    } else {
      await chrome.alarms.clear(ALARM_NAME);
    }
    return { ok: true, locked: isFocusLocked(focusLock) };
  });
}

async function mutateBlocklist(action) {
  return serialize(async () => {
    const state = await readState();
    if (isFocusLocked(state.focusLock)) return { ok: false, error: 'blocklist-locked' };

    let blocklist;
    if (action.type === 'add-domain') {
      const domain = normalizeDomain(action.domain);
      if (!domain) return { ok: false, error: 'invalid-domain' };
      if (state.blocklist.includes(domain)) return { ok: true, state };
      if (state.blocklist.length >= MAX_BLOCKED_DOMAINS) return { ok: false, error: 'blocklist-full' };
      blocklist = [...state.blocklist, domain];
    } else if (action.type === 'remove-domain') {
      if (typeof action.domain !== 'string') return { ok: false, error: 'invalid-domain' };
      blocklist = state.blocklist.filter((domain) => domain !== action.domain);
    } else {
      return { ok: false, error: 'unknown-action' };
    }

    await applyRules([]);
    const nextState = { ...state, blocklist };
    await saveState(nextState);
    return { ok: true, state: nextState };
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || message.version !== 1) return false;

  if (message.type === 'studyvault.extension.get-state.v1') {
    void serialize(readState).then((state) => sendResponse({ ok: true, state }));
    return true;
  }
  if (message.type === 'studyvault.extension.add-domain.v1' || message.type === 'studyvault.extension.remove-domain.v1') {
    void mutateBlocklist({ ...message, type: message.type.endsWith('add-domain.v1') ? 'add-domain' : 'remove-domain' })
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: 'storage-or-rules-failed' }));
    return true;
  }
  return false;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAllowedWebOrigin(sender.url)) return false;
  if (!message || message.type !== 'studyvault.focus-session.v1') return false;
  void handleFocusMessage(message)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: 'storage-failed' }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void reconcile();
});

chrome.runtime.onStartup.addListener(() => void reconcile());
chrome.runtime.onInstalled.addListener(() => void reconcile());
void reconcile();
