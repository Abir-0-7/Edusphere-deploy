import { describe, expect, it } from 'vitest';
import { CYBERVERSE_MISSIONS, gameVaultCatalog, getVaultGame } from '../src/lib/game-vault/catalog';
import {
  completeDemo,
  demoStorageKey,
  freshDemo,
  loadDemo,
  saveDemo,
  unlockDemo,
} from '../src/lib/game-vault/demo-store';
import {
  hostMessage,
  readGameMessage,
  readVaultState,
  type VaultState,
} from '../src/lib/game-vault/protocol';

const game = getVaultGame('cyberverse')!;
const student = { id: 'student-a', displayName: 'Student A' };
const evidence = { challengeVersion: 'binary-v1', answers: [1, 2, 0, 3, 2, 0] };

describe('Game Vault catalog', () => {
  it('keeps CYBERVERSE first and the original arcade available', () => {
    expect(gameVaultCatalog[0]?.id).toBe('cyberverse');
    expect(getVaultGame('logic-arcade')?.entryUrl).toBe('/games/index.html');
    expect(CYBERVERSE_MISSIONS.map((mission) => mission.tokens)).toEqual([5, 10, 15, 20, 25, 30]);
    expect(getVaultGame('unknown')).toBeUndefined();
  });
});

describe('same-origin postMessage boundary', () => {
  const frame = {} as Window;
  const origin = 'https://edusphere.example';
  const data = {
    ...hostMessage('cyberverse', 'EDUSPHERE_INIT_CONTEXT', '', {}),
    type: 'EDUSPHERE_GAME_READY',
  };
  it('accepts only the expected source, origin and catalog game', () => {
    expect(readGameMessage({ source: frame, origin, data }, frame, origin, game)?.type).toBe(
      'EDUSPHERE_GAME_READY',
    );
    expect(readGameMessage({ source: {} as Window, origin, data }, frame, origin, game)).toBeNull();
    expect(
      readGameMessage({ source: frame, origin: 'https://evil.example', data }, frame, origin, game),
    ).toBeNull();
    expect(
      readGameMessage({ source: frame, origin, data: { ...data, gameId: 'wrong' } }, frame, origin, game),
    ).toBeNull();
  });
  it('rejects invalid requests and oversized envelopes', () => {
    const event = {
      source: frame,
      origin,
      data: {
        ...data,
        type: 'EDUSPHERE_UNLOCK_MISSION_REQUEST',
        requestId: 'req',
        payload: { missionId: 'binary_city' },
      },
    };
    expect(readGameMessage(event, frame, origin, game)?.payload.missionId).toBe('binary_city');
    expect(
      readGameMessage({ ...event, data: { ...event.data, requestId: '' } }, frame, origin, game),
    ).toBeNull();
    expect(
      readGameMessage(
        { ...event, data: { ...event.data, payload: { missionId: 'not_known' } } },
        frame,
        origin,
        game,
      ),
    ).toBeNull();
    expect(
      readGameMessage(
        {
          ...event,
          data: { ...event.data, payload: { missionId: 'binary_city', extra: 'a'.repeat(66000) } },
        },
        frame,
        origin,
        game,
      ),
    ).toBeNull();
  });
  it('validates authoritative snapshots', () => {
    const valid = freshDemo(student);
    expect(readVaultState(valid, game)).toEqual(valid);
    expect(readVaultState({ ...valid, tokens: -5 }, game)).toBeNull();
    expect(readVaultState({ ...valid, completed: ['binary_city'] }, game)).toBeNull();
    expect(readVaultState({ ...valid, unlocked: ['wrong'] }, game)).toBeNull();
  });
});

describe('isolated offline demo', () => {
  it('charges each mission once and rejects insufficient balances without mutation', () => {
    let state = freshDemo(student);
    for (const mission of CYBERVERSE_MISSIONS) {
      const result = unlockDemo(state, game.id, mission.id);
      if (result.ok) {
        expect(result.state.tokens).toBe(state.tokens - mission.tokens);
        expect(unlockDemo(result.state, game.id, mission.id)).toEqual(result);
        state = result.state;
      } else {
        expect(result.error).toBe('insufficient_tokens');
        expect(state.tokens).toBe(25);
      }
    }
    expect(state.tokens).toBe(25);
    expect(state.unlocked).not.toContain('malware_core');
  });
  it('validates answers, awards XP once and never changes tokens on completion', () => {
    const unlocked = unlockDemo(freshDemo(student), game.id, 'binary_city');
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) return;
    expect(completeDemo(unlocked.state, game.id, 'binary_city', { ...evidence, answers: [] })).toEqual({
      ok: false,
      error: 'completion_rejected',
    });
    const done = completeDemo(unlocked.state, game.id, 'binary_city', evidence);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.state.tokens).toBe(95);
    expect(done.state.xp).toBe(100);
    expect(done.state.achievements).toEqual(['first_transmission']);
    expect(completeDemo(done.state, game.id, 'binary_city', evidence)).toEqual(done);
    expect(completeDemo(done.state, game.id, 'code_district', evidence).ok).toBe(false);
  });
  it('persists separately per student and cannot import production state', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const initial = freshDemo(student);
    const result = unlockDemo(initial, game.id, 'binary_city');
    if (!result.ok) throw new Error('Demo unlock failed');
    saveDemo(storage, game.id, result.state);
    expect(loadDemo(storage, student, game.id).tokens).toBe(95);
    expect(loadDemo(storage, { id: 'student-b', displayName: 'B' }, game.id).tokens).toBe(100);
    const production: VaultState = { ...result.state, mode: 'production', tokens: 999 };
    expect(saveDemo(storage, game.id, production)).toBe(false);
    storage.setItem(demoStorageKey(student.id, game.id), JSON.stringify(production));
    expect(loadDemo(storage, student, game.id)).toEqual(initial);
    storage.setItem(demoStorageKey(student.id, game.id), '{broken');
    expect(loadDemo(storage, student, game.id)).toEqual(initial);
  });
});
