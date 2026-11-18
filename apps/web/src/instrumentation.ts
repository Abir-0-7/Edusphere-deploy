/**
 * Next.js instrumentation hook: runs once when the server boots.
 * Fails fast with a clear message if required env vars are missing (task 1.6).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getEnv } = await import('./env');
  getEnv();
}
