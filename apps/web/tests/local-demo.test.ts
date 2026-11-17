import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLocalDemoEnabled,
  isLocalDemoHost,
  isLocalDemoPage,
  isLocalDemoRequest,
} from '../src/lib/local-demo';

afterEach(() => {
  vi.unstubAllEnvs();
});

function enableLocalDemo() {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('EDUSPHERE_LOCAL_DEMO', 'true');
}

describe('explicit development-only local demo mode', () => {
  it('requires both development and the explicit demo flag', () => {
    expect(isLocalDemoEnabled({ NODE_ENV: 'development', EDUSPHERE_LOCAL_DEMO: 'true' })).toBe(true);
    expect(isLocalDemoEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isLocalDemoEnabled({ NODE_ENV: 'development', EDUSPHERE_LOCAL_DEMO: 'false' })).toBe(false);
    expect(isLocalDemoEnabled({ NODE_ENV: 'development', EDUSPHERE_LOCAL_DEMO: 'TRUE' })).toBe(false);
    expect(isLocalDemoEnabled({ EDUSPHERE_LOCAL_DEMO: 'true' })).toBe(false);
  });

  it('never enables the demo in production or test mode', () => {
    expect(isLocalDemoEnabled({ NODE_ENV: 'production', EDUSPHERE_LOCAL_DEMO: 'true' })).toBe(false);
    expect(isLocalDemoEnabled({ NODE_ENV: 'test', EDUSPHERE_LOCAL_DEMO: 'true' })).toBe(false);
  });

  it('reads the explicit flag from the server environment', () => {
    enableLocalDemo();
    expect(isLocalDemoEnabled()).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(isLocalDemoEnabled()).toBe(false);
  });
});

describe('loopback-only host validation', () => {
  it('accepts the supported local hostnames, with optional ports', () => {
    for (const host of [
      'localhost',
      'localhost:3000',
      '127.0.0.1',
      '127.0.0.1:3000',
      '[::1]',
      '[::1]:3000',
    ]) {
      expect(isLocalDemoHost(host), host).toBe(true);
    }
  });

  it('rejects missing, remote and misleading hostnames', () => {
    for (const host of [
      null,
      '',
      'school.example',
      'school.example:3000',
      'localhost.evil.example',
      '127.0.0.1.evil.example',
      '192.168.1.2',
      '0.0.0.0',
      'evil.example@localhost',
      'localhost/path',
      'localhost?demo=1',
      'localhost#demo',
      ' localhost',
      'localhost\\path',
    ]) {
      expect(isLocalDemoHost(host), String(host)).toBe(false);
    }
  });
});

describe('local demo request boundary', () => {
  it('accepts loopback requests only while the development flag is enabled', () => {
    enableLocalDemo();
    for (const url of [
      'http://localhost:3000/api/game-vault/context',
      'http://127.0.0.1:3000/api/game-vault/context',
      'http://[::1]:3000/api/game-vault/context',
    ]) {
      expect(isLocalDemoRequest(new Request(url, { headers: { host: new URL(url).host } })), url).toBe(true);
    }
    expect(isLocalDemoRequest(new Request('https://school.example/api/game-vault/context'))).toBe(false);
    expect(
      isLocalDemoRequest(new Request('http://localhost:3000/games', { headers: { host: 'remote.example' } })),
    ).toBe(false);
    vi.stubEnv('EDUSPHERE_LOCAL_DEMO', 'false');
    expect(
      isLocalDemoRequest(
        new Request('http://localhost:3000/api/game-vault/context', { headers: { host: 'localhost:3000' } }),
      ),
    ).toBe(false);
  });

  it('cannot activate production request handling using the demo flag', () => {
    enableLocalDemo();
    vi.stubEnv('NODE_ENV', 'production');
    expect(
      isLocalDemoRequest(
        new Request('http://localhost:3000/api/game-vault/context', { headers: { host: 'localhost:3000' } }),
      ),
    ).toBe(false);
  });
});

describe('local demo page marker', () => {
  it('requires the proxy marker and a loopback Host header', () => {
    enableLocalDemo();
    const valid = new Headers({ host: 'localhost:3000', 'x-edusphere-local-demo': '1' });
    expect(isLocalDemoPage(valid)).toBe(true);
    expect(isLocalDemoPage(new Headers({ host: 'localhost:3000' }))).toBe(false);
    expect(isLocalDemoPage(new Headers({ host: 'localhost:3000', 'x-edusphere-local-demo': 'true' }))).toBe(
      false,
    );
    expect(isLocalDemoPage(new Headers({ host: 'school.example', 'x-edusphere-local-demo': '1' }))).toBe(
      false,
    );
    expect(isLocalDemoPage(new Headers({ 'x-edusphere-local-demo': '1' }))).toBe(false);
  });

  it('rejects the marker when the flag is absent or in production', () => {
    const headers = new Headers({ host: 'localhost:3000', 'x-edusphere-local-demo': '1' });
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EDUSPHERE_LOCAL_DEMO', 'false');
    expect(isLocalDemoPage(headers)).toBe(false);
    vi.stubEnv('EDUSPHERE_LOCAL_DEMO', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    expect(isLocalDemoPage(headers)).toBe(false);
  });
});
