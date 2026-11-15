import { describe, expect, it, vi } from 'vitest';
import { sendFocusExtensionMessage } from '../src/lib/extension-bridge';

describe('focus extension bridge', () => {
  it('sends a versioned active-session message to the configured extension', () => {
    const sendMessage = vi.fn((_id: string, _message: unknown, callback?: () => void) => callback?.());
    const chromeApi = { runtime: { sendMessage } };

    expect(
      sendFocusExtensionMessage(
        {
          version: 1,
          type: 'studyvault.focus-session.v1',
          active: true,
          sessionId: '7504d84c-ec6a-4bd7-8cd6-3f69b3ea72c6',
          expectedEndAt: '2026-11-16T12:00:00Z',
          sentAt: 1794829800000,
        },
        'a'.repeat(32),
        chromeApi,
      ),
    ).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      'a'.repeat(32),
      {
        version: 1,
        type: 'studyvault.focus-session.v1',
        active: true,
        sessionId: '7504d84c-ec6a-4bd7-8cd6-3f69b3ea72c6',
        expectedEndAt: '2026-11-16T12:00:00Z',
        sentAt: 1794829800000,
      },
      expect.any(Function),
    );
  });

  it('does nothing when no extension ID or runtime is available', () => {
    const inactive = {
      version: 1,
      type: 'studyvault.focus-session.v1',
      active: false,
      sessionId: null,
      expectedEndAt: null,
      sentAt: 1794829800000,
    } as const;
    expect(sendFocusExtensionMessage(inactive, undefined, { runtime: { sendMessage: vi.fn() } })).toBe(false);
    expect(sendFocusExtensionMessage(inactive, 'a'.repeat(32), undefined)).toBe(false);
  });
});
