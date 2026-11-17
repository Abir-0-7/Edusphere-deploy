/** Explicit, loopback-only development mode; never a production auth fallback. */
export function isLocalDemoEnabled(source: Record<string, string | undefined> = process.env): boolean {
  return source.NODE_ENV === 'development' && source.EDUSPHERE_LOCAL_DEMO === 'true';
}

export function isLocalDemoHost(host: string | null): boolean {
  if (!host) return false;
  if (/[\s/@?#\\]/.test(host)) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

export function isLocalDemoRequest(request: Pick<Request, 'url' | 'headers'>): boolean {
  const host = request.headers.get('host');
  return isLocalDemoEnabled() && isLocalDemoHost(new URL(request.url).host) && isLocalDemoHost(host);
}

export function isLocalDemoPage(headers: Pick<Headers, 'get'>): boolean {
  return (
    isLocalDemoEnabled() &&
    headers.get('x-edusphere-local-demo') === '1' &&
    isLocalDemoHost(headers.get('host'))
  );
}
