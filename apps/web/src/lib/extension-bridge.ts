export type FocusExtensionMessage =
  | {
      version: 1;
      type: 'studyvault.focus-session.v1';
      active: true;
      sessionId: string;
      expectedEndAt: string;
      sentAt: number;
    }
  | {
      version: 1;
      type: 'studyvault.focus-session.v1';
      active: false;
      sessionId: string | null;
      expectedEndAt: null;
      sentAt: number;
    };

interface ExtensionRuntime {
  lastError?: { message?: string };
  sendMessage(
    extensionId: string,
    message: FocusExtensionMessage,
    callback?: (response?: unknown) => void,
  ): void;
}

interface ChromeApi {
  runtime?: ExtensionRuntime;
}

declare global {
  interface Window {
    chrome?: ChromeApi;
  }
}

export function sendFocusExtensionMessage(
  message: FocusExtensionMessage,
  extensionId = process.env.NEXT_PUBLIC_STUDYVAULT_EXTENSION_ID,
  chromeApi: ChromeApi | undefined = typeof window === 'undefined' ? undefined : window.chrome,
): boolean {
  const runtime = chromeApi?.runtime;
  if (!extensionId || !runtime) return false;

  runtime.sendMessage(extensionId, message, () => {
    // Read lastError so Chrome does not report a missing extension as unhandled.
    void runtime.lastError;
  });
  return true;
}
