export const MAX_BLOCKED_DOMAINS = 500;
export const OWN_RULE_ID_START = 1000;

export function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim().replace(/\.$/, '').toLowerCase();
  if (!input || input.length > 253 || /[\s/:?#@*\\]/.test(input)) return null;

  let hostname;
  try {
    hostname = new URL(`https://${input}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }

  if (hostname !== 'localhost' && !hostname.includes('.')) return null;
  if (hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return hostname;
}

export function normalizeBlocklist(values) {
  if (!Array.isArray(values)) return [];
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    const domain = normalizeDomain(value);
    if (domain && !seen.has(domain)) {
      seen.add(domain);
      normalized.push(domain);
    }
    if (normalized.length === MAX_BLOCKED_DOMAINS) break;
  }
  return normalized;
}

export function createBlockingRules(domains) {
  return normalizeBlocklist(domains).map((domain, index) => ({
    id: OWN_RULE_ID_START + index,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ['main_frame'],
    },
  }));
}
