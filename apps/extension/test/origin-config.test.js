import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedWebOrigin } from '../src/origin-config.js';

const config = { exactOrigins: ['https://study.example', 'https://study.example:8443'], developmentHosts: ['localhost', '127.0.0.1'] };

test('allows exact configured production origins and loopback development origins', () => {
  assert.equal(isAllowedWebOrigin('https://study.example/dashboard', config), true);
  assert.equal(isAllowedWebOrigin('https://study.example:8443/focus', config), true);
  assert.equal(isAllowedWebOrigin('http://localhost:3000/', config), true);
  assert.equal(isAllowedWebOrigin('http://127.0.0.1:3000/', config), true);
});

test('rejects unlisted production origins, lookalikes, non-http loopback and opaque senders', () => {
  for (const url of [
    'https://attacker.example/',
    'https://study.example.attacker.example/',
    'https://study.example:9443/',
    'http://study.example/',
    'https://localhost:3000/',
    'null',
  ]) {
    assert.equal(isAllowedWebOrigin(url, config), false, url);
  }
});
