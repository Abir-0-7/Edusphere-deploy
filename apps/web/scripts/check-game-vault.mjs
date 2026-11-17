import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import vm from 'node:vm';
import process from 'node:process';

// Dependency-free contract smoke tests; not a substitute for TypeScript/Vitest/build.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { gameVaultCatalog, getVaultGame } = await import('../src/lib/game-vault/catalog.ts');
const { hostMessage, readGameMessage, readVaultState } = await import('../src/lib/game-vault/protocol.ts');
const { freshDemo, unlockDemo, completeDemo, loadDemo, saveDemo } = await import('../src/lib/game-vault/demo-store.ts');
const { CYBERVERSE_MISSIONS, validBinaryEvidence } = await import('../src/lib/game-vault/mission-rules.ts');
const game = getVaultGame('cyberverse');
const evidence = { challengeVersion: 'binary-v1', answers: [1, 2, 0, 3, 2, 0] };
assert.equal(gameVaultCatalog[0].id, 'cyberverse');
assert.equal(getVaultGame('logic-arcade').entryUrl, '/games/index.html');
assert.deepEqual(game.missions.map((mission) => mission.tokens), [5, 10, 15, 20, 25, 30]);
for (const mission of game.missions) {
  assert.equal(CYBERVERSE_MISSIONS[mission.id].cost, mission.tokens);
  let state = freshDemo({ id: 'contract-test', displayName: 'Test' });
  const result = unlockDemo(state, game.id, mission.id);
  assert.equal(result.ok, true);
  state = result.state;
  assert.equal(state.tokens, 100 - mission.tokens);
  assert.deepEqual(unlockDemo(state, game.id, mission.id).state, state);
}
let state = unlockDemo(freshDemo({ id: 'contract-test', displayName: 'Test' }), game.id, 'binary_city').state;
assert.equal(completeDemo(state, game.id, 'binary_city', { ...evidence, answers: [] }).ok, false);
state = completeDemo(state, game.id, 'binary_city', evidence).state;
assert.equal(state.tokens, 95);
assert.equal(state.xp, 100);
assert.deepEqual(state.achievements, ['first_transmission']);
assert.deepEqual(completeDemo(state, game.id, 'binary_city', evidence).state, state);
assert.equal(validBinaryEvidence(evidence), true);
assert.equal(validBinaryEvidence({ ...evidence, answers: [1] }), false);
const values = new Map();
const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
assert.equal(saveDemo(storage, game.id, state), true);
assert.deepEqual(loadDemo(storage, state.student, game.id), state);
assert.equal(saveDemo(storage, game.id, { ...state, mode: 'production' }), false);
assert.equal(loadDemo(storage, { id: 'other', displayName: 'Other' }, game.id).tokens, 100);
const frame = {};
const origin = 'https://school.example';
const message = { ...hostMessage(game.id, 'EDUSPHERE_INIT_CONTEXT', '', {}), type: 'EDUSPHERE_GAME_READY' };
assert.ok(readGameMessage({ source: frame, origin, data: message }, frame, origin, game));
assert.equal(readGameMessage({ source: {}, origin, data: message }, frame, origin, game), null);
assert.equal(readGameMessage({ source: frame, origin: 'https://other.example', data: message }, frame, origin, game), null);
assert.equal(readVaultState({ ...state, tokens: -1 }, game), null);

const bridgePath = new URL('../public/games/cyberverse/edusphere_bridge.js', import.meta.url);
if (existsSync(bridgePath)) {
  let receiver;
  const sent = [];
  const received = [];
  const parent = { postMessage: (data, target) => sent.push({ data, target }) };
  const window = { location: { origin }, parent, addEventListener: (_name, callback) => { receiver = callback; }, removeEventListener: () => {} };
  vm.runInNewContext(readFileSync(bridgePath, 'utf8'), { window, Set, JSON });
  const bridge = window.CyberverseEduSphereBridge;
  assert.equal(bridge.is_hosted(), true);
  bridge.install((value) => received.push(value));
  const init = hostMessage(game.id, 'EDUSPHERE_INIT_CONTEXT', '', state);
  receiver({ source: {}, origin, data: init });
  receiver({ source: parent, origin: 'https://other.example', data: init });
  assert.equal(received.length, 0);
  receiver({ source: parent, origin, data: init });
  assert.equal(received.length, 1);
  bridge.send_json(JSON.stringify(message));
  assert.equal(sent[0].target, origin);
  bridge.close();
}
process.stdout.write('PASS: catalog/server prices, all demo unlocks/replay, evidence/XP, per-student persistence, production isolation and origin/source contracts\n');
