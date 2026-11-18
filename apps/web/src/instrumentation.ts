/**
 * Validate core server configuration at startup. Upstash is optional in the
 * environment schema, so its absence does not prevent unrelated routes from
 * serving.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getEnv } = await import('./env');
  getEnv();
}
