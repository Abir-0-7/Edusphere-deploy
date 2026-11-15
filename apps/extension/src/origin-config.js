export const ORIGIN_CONFIG = Object.freeze({
  exactOrigins: [],
  developmentHosts: ['localhost', '127.0.0.1'],
});

export function isAllowedWebOrigin(senderUrl, config = ORIGIN_CONFIG) {
  if (typeof senderUrl !== 'string') return false;
  let url;
  try {
    url = new URL(senderUrl);
  } catch {
    return false;
  }
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return false;

  if (config.exactOrigins.includes(url.origin)) return true;
  return url.protocol === 'http:' && config.developmentHosts.includes(url.hostname);
}
