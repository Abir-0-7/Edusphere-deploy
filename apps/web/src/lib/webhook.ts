/**
 * Clerk webhook signature verification (svix scheme).
 *
 * Kept dependency-free: implements the svix HMAC check directly so the route
 * doesn't pull in the `svix` package. Signature is HMAC-SHA256 over
 * `{svix-id}.{svix-timestamp}.{body}` with the whsec_ base64 secret, compared
 * against every `v1,` token in the svix-signature header; a 5-minute tolerance
 * rejects replays.
 */
import { createHmac, timingSafeEqual } from 'crypto';

const TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  'svix-id': string;
  'svix-timestamp': string;
  'svix-signature': string;
}

export function verifyClerkWebhook(
  body: string,
  headers: SvixHeaders,
  signingSecret: string,
): { type: string; data: Record<string, unknown> } {
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sigHeader = headers['svix-signature'];
  if (!id || !ts || !sigHeader) throw new Error('missing svix headers');

  // Replay window.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) throw new Error('timestamp out of tolerance');

  const secret = signingSecret.startsWith('whsec_') ? signingSecret.slice('whsec_'.length) : signingSecret;
  const key = Buffer.from(secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`, 'utf8').digest('base64');
  const expectedBuf = Buffer.from(expected, 'utf8');

  // Header may carry several space-separated signatures of the form `v1,<b64>`.
  const valid = sigHeader
    .split(' ')
    .map((part) => part.trim())
    .filter((p) => p.startsWith('v1,'))
    .map((p) => p.slice('v1,'.length))
    .some((candidate) => {
      const buf = Buffer.from(candidate, 'utf8');
      return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
    });
  if (!valid) throw new Error('signature mismatch');

  return JSON.parse(body) as { type: string; data: Record<string, unknown> };
}
