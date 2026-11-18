import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { errorBody } from '@/lib/errors';
import { getUserByClerkId } from '@/lib/users';

export function gameStoreUnavailable(message = 'Game saves are temporarily unavailable; try again.') {
  return NextResponse.json(errorBody('internal', message), { status: 503 });
}

/** Resolve identity separately so store or Clerk outages do not become sign-outs. */
export async function getGameAccount() {
  try {
    const { userId } = await auth();
    const user = userId ? await getUserByClerkId(userId) : null;
    if (user) return { ok: true as const, user };
    return {
      ok: false as const,
      response: NextResponse.json(errorBody('unauthorized', 'sign in required'), { status: 401 }),
    };
  } catch {
    return {
      ok: false as const,
      response: gameStoreUnavailable('Game account is temporarily unavailable; try again.'),
    };
  }
}
