import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { checkAiRateLimit, consumeAiQuota } from '@/lib/rate-limit';
import { getEnv } from '@/env';

/**
 * Example rate-limited + quota-checked AI route (task 1.11 DoD).
 *
 * Demonstrates the full guard path a real AI call takes: auth → per-minute
 * limit → daily quota → proxy to ai-service with the user's session token.
 * The heavy lifting lives in ai-service; this is the web-side enforcement.
 */
export async function POST(req: Request) {
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'sign in required' } },
      { status: 401 },
    );
  }

  const limited = await checkAiRateLimit(userId);
  if (!limited.ok) {
    return NextResponse.json(
      {
        error: {
          code: 'rate_limited',
          message:
            limited.reason === 'daily_quota'
              ? 'Daily AI quota reached; resets at midnight UTC'
              : 'Too many requests; slow down',
          details: { retryAfterSeconds: limited.retryAfterSeconds },
        },
      },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds ?? 60) } },
    );
  }

  const token = await getToken();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const upstream = await fetch(`${getEnv().AI_SERVICE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token ?? ''}`,
      'x-internal-token': getEnv().AI_SERVICE_INTERNAL_TOKEN,
    },
    body: JSON.stringify(body),
  });

  if (upstream.ok) await consumeAiQuota(userId);

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
