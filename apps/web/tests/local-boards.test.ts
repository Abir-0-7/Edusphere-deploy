import { describe, expect, it } from 'vitest';
import { boardStorageKeys, clearLocalBoard, loadLocalBoard, saveLocalBoard } from '../src/lib/local-boards';

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe('account-scoped boards', () => {
  it('separates manual snapshots and tldraw persistence/broadcast namespaces', () => {
    const local = storage();
    saveLocalBoard('alice', 'alice private board', local);
    expect(loadLocalBoard('bob', local)).toBeNull();
    saveLocalBoard('bob', 'bob board', local);
    expect(loadLocalBoard('alice', local)).toBe('alice private board');
    expect(loadLocalBoard('bob', local)).toBe('bob board');
    expect(boardStorageKeys('alice').persistence).not.toBe(boardStorageKeys('bob').persistence);
  });

  it('clears only the current account snapshot and leaves other accounts and legacy data untouched', () => {
    const local = storage();
    local.setItem('studyvault_whiteboard', 'unknown legacy owner');
    saveLocalBoard('alice', 'alice board', local);
    saveLocalBoard('bob', 'bob board', local);
    clearLocalBoard('bob', local);
    expect(loadLocalBoard('bob', local)).toBeNull();
    expect(loadLocalBoard('alice', local)).toBe('alice board');
    expect(local.getItem('studyvault_whiteboard')).toBe('unknown legacy owner');
    expect(loadLocalBoard('next-account', local)).toBeNull();
  });

  it('rejects missing account scope and encodes keys without collisions', () => {
    expect(() => boardStorageKeys('')).toThrow();
    expect(boardStorageKeys('user:a').snapshot).not.toBe(boardStorageKeys('user%3Aa').snapshot);
  });

  it('surfaces unavailable local storage for the UI to report', () => {
    const local = storage();
    local.setItem = () => { throw new Error('Quota exceeded'); };
    expect(() => saveLocalBoard('alice', 'board', local)).toThrow('Quota exceeded');
  });
});
