export type ContentSecurityPolicyDirectives = Partial<
  Record<
    | 'base-uri'
    | 'connect-src'
    | 'font-src'
    | 'form-action'
    | 'frame-ancestors'
    | 'img-src'
    | 'media-src'
    | 'object-src',
    string[]
  >
>;

export function getContentSecurityPolicyDirectives(aiServiceUrl: string): ContentSecurityPolicyDirectives {
  const aiOrigin = new URL(aiServiceUrl).origin;
  return {
    'base-uri': ["'self'"],
    'connect-src': [aiOrigin],
    'font-src': ["'self'", 'data:'],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
  };
}
