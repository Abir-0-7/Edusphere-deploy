import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateCompletion, type GameAction } from '@studyvault/game-engine';
import { tokenLedger } from '@studyvault/db';
import { getDb } from '@/lib/db';
import { getUserByClerkId } from '@/lib/users';
import { errorBody } from '@/lib/errors';

const CompletionSchema = z.object({
  game_id: z.enum(['SortingRace', 'NQueens', 'TowersOfHanoi', 'FlashcardTowerDefense']),
  actions: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('swap'), left: z.number().int(), right: z.number().int() }),
    z.object({ type: z.literal('place'), row: z.number().int(), column: z.number().int() }),
    z.object({ type: z.literal('move'), from: z.number().int(), to: z.number().int() }),
    z.object({ type: z.literal('spawn'), lane: z.number().int().min(0).max(2), hp: z.number().int().min(1).max(1) }),
    z.object({ type: z.literal('answer'), enemyId: z.number().int().positive(), answer: z.boolean() }),
  ])).min(1).max(500),
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json(errorBody('sign in required', 'unauthorized'), { status: 401 });
  const input = CompletionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json(errorBody('invalid game completion', 'invalid_input'), { status: 400 });
  const completion = validateCompletion(input.data.game_id, input.data.actions as GameAction[]);
  if (!completion.complete) return NextResponse.json(errorBody('game completion could not be verified', 'invalid_input'), { status: 400 });
  const user = await getUserByClerkId(userId);
  if (!user) return NextResponse.json(errorBody('user not found', 'not_found'), { status: 404 });
  const reason = `game:${input.data.game_id}:${new Date().toISOString().slice(0, 10)}`;
  const amount = Math.min(5, Math.max(1, Math.floor(completion.score / 200)));
  const db = getDb();
  const [existing] = await db.select({ amount: tokenLedger.amount }).from(tokenLedger)
    .where(and(eq(tokenLedger.userId, user.id), eq(tokenLedger.reason, reason), eq(tokenLedger.refId, user.id))).limit(1);
  if (existing) return NextResponse.json({ tokens_awarded: existing.amount, idempotent: true });
  const [entry] = await db.insert(tokenLedger).values({ userId: user.id, amount, reason, refId: user.id }).onConflictDoNothing().returning({ amount: tokenLedger.amount });
  return NextResponse.json({ tokens_awarded: entry?.amount ?? amount, idempotent: !entry }, { status: 201 });
}
