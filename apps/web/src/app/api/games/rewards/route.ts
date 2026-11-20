import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { validateCompletion } from '@studyvault/game-engine';
import { GameCompletionRequestSchema, GameRewardResponseSchema } from '@studyvault/types';
import { tokenLedger } from '@studyvault/db';
import { getDb } from '@/lib/db';
import { getUserByClerkId } from '@/lib/users';
import { errorBody } from '@/lib/errors';
import { gameFocusLocked, hasActiveFocusSession } from '@/lib/game-focus-lock';

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json(errorBody('sign in required', 'unauthorized'), { status: 401 });
  const input = GameCompletionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(errorBody('invalid game completion', 'invalid_input'), { status: 400 });
  const completion = validateCompletion(input.data.game_id, input.data.actions);
  if (!completion.complete)
    return NextResponse.json(errorBody('game completion could not be verified', 'invalid_input'), {
      status: 400,
    });
  const user = await getUserByClerkId(userId);
  if (!user) return NextResponse.json(errorBody('user not found', 'not_found'), { status: 404 });
  const reason = `game:${input.data.game_id}:${new Date().toISOString().slice(0, 10)}`;
  const amount = Math.min(5, Math.max(1, Math.floor(completion.score / 200)));
  const db = getDb();
  try {
    if (await hasActiveFocusSession(db, user.id)) return gameFocusLocked();
  } catch {
    return NextResponse.json(errorBody('internal', 'Could not check your focus session. Try again.'), {
      status: 503,
    });
  }
  // The existing (reason, ref_id) unique constraint resolves duplicate and
  // concurrent completions atomically. The server derives owner/day/amount.
  const [entry] = await db
    .insert(tokenLedger)
    .values({ userId: user.id, amount, reason, refId: user.id })
    .onConflictDoNothing()
    .returning({ amount: tokenLedger.amount });
  return NextResponse.json(
    GameRewardResponseSchema.parse({ tokens_awarded: entry?.amount ?? 0, idempotent: !entry }),
    { status: entry ? 201 : 200 },
  );
}
