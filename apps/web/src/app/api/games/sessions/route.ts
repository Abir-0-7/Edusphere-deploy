import { count, desc, eq } from 'drizzle-orm';
import { gameSessions, users } from '@studyvault/db';
import {
  GameCreateInputSchema,
  GameIdSchema,
  GameSessionListSchema,
  type GameConfig,
  type GameSession,
} from '@studyvault/types';
import { createGame, serializeGame } from '@studyvault/game-engine';
import { NextResponse } from 'next/server';
import { errorBody } from '@/lib/errors';
import { getDb } from '@/lib/db';
import { gameStoreUnavailable, getGameAccount } from '@/lib/game-session-account';
import { gameRequestBody, sessionResponse } from '@/lib/game-session-state';
import { GameFocusActiveError, gameFocusLocked, hasActiveFocusSession } from '@/lib/game-focus-lock';

function seed(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0]!;
}

export async function GET() {
  const account = await getGameAccount();
  if (!account.ok) return account.response;
  const { user } = account;
  let rows: (typeof gameSessions.$inferSelect)[];
  try {
    rows = await getDb()
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.userId, user.id))
      .orderBy(desc(gameSessions.updatedAt))
      .limit(100);
  } catch {
    return gameStoreUnavailable();
  }
  const progression = Object.fromEntries(GameIdSchema.options.map((id) => [id, 0])) as Record<
    GameSession['snapshot']['config']['game_id'],
    number
  >;
  for (const row of rows)
    if (row.status === 'won')
      progression[row.gameId as keyof typeof progression] =
        (progression[row.gameId as keyof typeof progression] ?? 0) + 1;
  return NextResponse.json(GameSessionListSchema.parse({ sessions: rows.map(sessionResponse), progression }));
}

export async function POST(request: Request) {
  const account = await getGameAccount();
  if (!account.ok) return account.response;
  const { user } = account;
  const parsed = GameCreateInputSchema.safeParse(await gameRequestBody(request));
  if (!parsed.success)
    return NextResponse.json(errorBody('invalid_input', 'invalid game session', parsed.error.flatten()), {
      status: 400,
    });
  const config: GameConfig = {
    version: 1,
    game_id: parsed.data.game_id,
    difficulty: parsed.data.difficulty,
    seed: seed(),
    practice: parsed.data.practice,
    ...(parsed.data.objective_id ? { objective_id: parsed.data.objective_id } : {}),
  };
  const snapshot = serializeGame(createGame(config));
  let row: typeof gameSessions.$inferSelect | null;
  try {
    row = await getDb().transaction(async (tx) => {
      const [owner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, user.id))
        .for('update');
      if (!owner) throw new Error('game account no longer exists');
      if (await hasActiveFocusSession(tx, user.id)) throw new GameFocusActiveError();
      const [total] = await tx
        .select({ value: count() })
        .from(gameSessions)
        .where(eq(gameSessions.userId, user.id));
      if ((total?.value ?? 0) >= 100) return null;
      const [created] = await tx
        .insert(gameSessions)
        .values({
          userId: user.id,
          gameId: config.game_id,
          snapshot,
          status: 'ready',
          revision: 0,
          tokensAwarded: 0,
        })
        .returning();
      if (!created) throw new Error('game save was not created');
      return created;
    });
  } catch (error) {
    if (error instanceof GameFocusActiveError) return gameFocusLocked();
    return gameStoreUnavailable('Game could not be saved; try again.');
  }
  if (row === null)
    return NextResponse.json(errorBody('rate_limited', 'saved game limit reached (100 sessions)'), {
      status: 429,
    });
  return NextResponse.json(sessionResponse(row), { status: 201 });
}
