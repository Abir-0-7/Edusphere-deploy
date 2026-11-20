import { and, eq } from 'drizzle-orm';
import { focusSessions } from '@studyvault/db';
import { NextResponse } from 'next/server';
import type { getDb } from '@/lib/db';
import { errorBody } from '@/lib/errors';

export const GAME_FOCUS_LOCK_MESSAGE =
  'Game Vault is locked during your focus session. End the session to play games.';

/** A timer stays active until completion is saved, even when its countdown has
 * elapsed. This matches focus-session restoration and its completion retry UI. */
export async function hasActiveFocusSession(
  database: Pick<ReturnType<typeof getDb>, 'select'>,
  userId: string,
) {
  const [session] = await database
    .select({ id: focusSessions.id })
    .from(focusSessions)
    .where(and(eq(focusSessions.userId, userId), eq(focusSessions.status, 'running')))
    .limit(1);
  return !!session;
}

export class GameFocusActiveError extends Error {
  constructor() {
    super(GAME_FOCUS_LOCK_MESSAGE);
  }
}

export function gameFocusLocked() {
  return NextResponse.json(errorBody('conflict', GAME_FOCUS_LOCK_MESSAGE), {
    status: 409,
    headers: { 'Cache-Control': 'no-store' },
  });
}
