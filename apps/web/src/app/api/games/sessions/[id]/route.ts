import { and, eq } from 'drizzle-orm';
import { gameSessions, tokenLedger } from '@studyvault/db';
import { GameCommandInputSchema } from '@studyvault/types';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { errorBody } from '@/lib/errors';
import { getDb } from '@/lib/db';
import { gameStoreUnavailable, getGameAccount } from '@/lib/game-session-account';
import { gameRequestBody, sessionResponse, transitionSession } from '@/lib/game-session-state';
import { GameFocusActiveError, gameFocusLocked, hasActiveFocusSession } from '@/lib/game-focus-lock';

type Context = { params: Promise<{ id: string }> };
const validId = z.string().uuid();
export async function GET(_request: Request, context: Context) {
  const account = await getGameAccount();
  if (!account.ok) return account.response;
  const { user } = account;
  const { id } = await context.params;
  if (!validId.safeParse(id).success)
    return NextResponse.json(errorBody('invalid_input', 'invalid session id'), { status: 400 });
  let row: typeof gameSessions.$inferSelect | undefined;
  try {
    [row] = await getDb()
      .select()
      .from(gameSessions)
      .where(and(eq(gameSessions.id, id), eq(gameSessions.userId, user.id)))
      .limit(1);
  } catch {
    return gameStoreUnavailable();
  }
  return row
    ? NextResponse.json(sessionResponse(row))
    : NextResponse.json(errorBody('not_found', 'game session not found'), { status: 404 });
}
/** User-requested removal of a save never removes the append-only reward ledger. */
export async function DELETE(_request: Request, context: Context) {
  const account = await getGameAccount();
  if (!account.ok) return account.response;
  const { user } = account;
  const { id } = await context.params;
  if (!validId.safeParse(id).success)
    return NextResponse.json(errorBody('invalid_input', 'invalid session id'), { status: 400 });
  try {
    const [deleted] = await getDb()
      .delete(gameSessions)
      .where(and(eq(gameSessions.id, id), eq(gameSessions.userId, user.id)))
      .returning({ id: gameSessions.id });
    return deleted
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json(errorBody('not_found', 'game session not found'), { status: 404 });
  } catch {
    return NextResponse.json(errorBody('internal', 'save could not be deleted; try again'), { status: 503 });
  }
}
export async function POST(request: Request, context: Context) {
  const account = await getGameAccount();
  if (!account.ok) return account.response;
  const { user } = account;
  const { id } = await context.params;
  if (!validId.safeParse(id).success)
    return NextResponse.json(errorBody('invalid_input', 'invalid session id'), { status: 400 });
  const parsed = GameCommandInputSchema.safeParse(await gameRequestBody(request));
  if (!parsed.success)
    return NextResponse.json(errorBody('invalid_input', 'invalid game command'), { status: 400 });
  try {
    const reply = await getDb().transaction(async (tx) => {
      // Row locking serializes all commands, including across web processes.
      const [row] = await tx
        .select()
        .from(gameSessions)
        .where(and(eq(gameSessions.id, id), eq(gameSessions.userId, user.id)))
        .limit(1)
        .for('update');
      if (!row) return { kind: 'not_found' as const };
      if (await hasActiveFocusSession(tx, user.id)) throw new GameFocusActiveError();
      if (row.revision !== parsed.data.revision) return { kind: 'conflict' as const };
      let next: ReturnType<typeof transitionSession>;
      try {
        next = transitionSession(row, parsed.data);
      } catch (error) {
        return {
          kind: 'invalid_action' as const,
          message: error instanceof Error ? error.message : 'invalid action',
        };
      }
      let tokensAwarded = row.tokensAwarded;
      if (next.reward > 0) {
        // Same owner/game/UTC-day cap as the legacy route, across all sessions.
        const [entry] = await tx
          .insert(tokenLedger)
          .values({
            userId: user.id,
            amount: next.reward,
            reason: `game:${row.gameId}:${new Date().toISOString().slice(0, 10)}`,
            refId: user.id,
          })
          .onConflictDoNothing()
          .returning({ amount: tokenLedger.amount });
        tokensAwarded = entry?.amount ?? 0;
      }
      const [updated] = await tx
        .update(gameSessions)
        .set({
          snapshot: next.snapshot,
          status: next.status,
          tokensAwarded,
          revision: row.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(gameSessions.id, id), eq(gameSessions.userId, user.id)))
        .returning();
      if (!updated) throw new Error('game session disappeared while locked');
      return { kind: 'ok' as const, row: updated };
    });
    if (reply.kind === 'not_found')
      return NextResponse.json(errorBody('not_found', 'game session not found'), { status: 404 });
    if (reply.kind === 'conflict')
      return NextResponse.json(errorBody('invalid_input', 'game session changed; reload to resume'), {
        status: 409,
      });
    if (reply.kind === 'invalid_action')
      return NextResponse.json(errorBody('invalid_input', reply.message), { status: 400 });
    return NextResponse.json(sessionResponse(reply.row));
  } catch (error) {
    if (error instanceof GameFocusActiveError) return gameFocusLocked();
    // A failed write rolls back both the session and ledger, leaving replay safe.
    return NextResponse.json(
      errorBody('internal', 'game session is temporarily unavailable; reload before retrying'),
      { status: 503 },
    );
  }
}
