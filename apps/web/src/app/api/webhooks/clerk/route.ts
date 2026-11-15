import { NextResponse } from 'next/server';
import { getEnv } from '@/env';
import { deleteUserByClerkId, upsertUserByClerkId } from '@/lib/users';
import { verifyClerkWebhook } from '@/lib/webhook';

/**
 * Clerk user-sync webhook (task 1.9). Verifies the svix signature, then applies
 * an idempotent upsert/delete so replays never duplicate a user.
 *
 * POST only; unauthenticated (signature proves it came from Clerk).
 */
export async function POST(req: Request) {
  const signingSecret = getEnv().CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    return NextResponse.json(
      { error: { code: 'internal', message: 'webhook signing secret not configured' } },
      { status: 500 },
    );
  }

  const body = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };
  if (!headers['svix-id'] || !headers['svix-signature']) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'missing signature' } },
      { status: 401 },
    );
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = verifyClerkWebhook(body, headers, signingSecret);
  } catch {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'invalid signature' } },
      { status: 401 },
    );
  }

  const { type, data } = event;
  const clerkId = typeof data.id === 'string' ? data.id : null;
  if (!clerkId) {
    return NextResponse.json({ error: { code: 'invalid_input', message: 'no user id' } }, { status: 400 });
  }

  const primaryEmail = extractPrimaryEmail(data);
  try {
    if (type === 'user.created' || type === 'user.updated') {
      if (primaryEmail) await upsertUserByClerkId(clerkId, primaryEmail);
    } else if (type === 'user.deleted') {
      await deleteUserByClerkId(clerkId);
    }
  } catch (err) {
    // Surface as 500 so Clerk retries; a sync failure must not be swallowed.
    return NextResponse.json(
      { error: { code: 'internal', message: err instanceof Error ? err.message : 'sync failed' } },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

function extractPrimaryEmail(data: Record<string, unknown>): string | null {
  const emails = data.email_addresses;
  if (!Array.isArray(emails) || emails.length === 0) return null;
  const primaryId = data.primary_email_address_id;
  const primary = primaryId
    ? emails.find((e: unknown) => (e as { id?: string }).id === primaryId)
    : emails[0];
  const addr = (primary as { email_address?: string })?.email_address;
  return typeof addr === 'string' ? addr : null;
}
