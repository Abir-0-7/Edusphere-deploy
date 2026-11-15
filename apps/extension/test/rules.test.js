import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlockingRules, normalizeBlocklist, normalizeDomain } from '../src/rules.js';

test('normalizes hostnames and internationalized domains', () => {
  assert.equal(normalizeDomain('  WWW.Example.COM. '), 'www.example.com');
  assert.equal(normalizeDomain('münich.example'), 'xn--mnich-kva.example');
  assert.equal(normalizeDomain('localhost'), 'localhost');
});

test('rejects URLs, paths, wildcards, ports, and one-label hosts', () => {
  for (const value of ['https://example.com', 'example.com/path', '*.example.com', 'example.com:8443', 'com', '']) {
    assert.equal(normalizeDomain(value), null, value);
  }
});

test('blocklists normalize duplicates and generate main-frame-only rules', () => {
  const domains = normalizeBlocklist(['example.com', 'EXAMPLE.com', 'news.example']);
  assert.deepEqual(domains, ['example.com', 'news.example']);
  assert.deepEqual(createBlockingRules(domains), [
    {
      id: 1000,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: '||example.com^', resourceTypes: ['main_frame'] },
    },
    {
      id: 1001,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: '||news.example^', resourceTypes: ['main_frame'] },
    },
  ]);
});
