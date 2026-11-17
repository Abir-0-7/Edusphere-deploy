import { and, eq, sql } from 'drizzle-orm';
import { gameMissionProgress, tokenLedger } from '@studyvault/db';
import { getDb } from '@/lib/db';
import { getUserByClerkId } from '@/lib/users';
import {
  CYBERVERSE_GAME_ID,
  CYBERVERSE_MISSIONS,
  isCyberverseMission,
  validBinaryEvidence,
} from './mission-rules';

export type VaultState = {
  mode: 'production';
  tokens: number;
  xp: number;
  unlocked: string[];
  completed: string[];
  achievements: string[];
  student: { id: string; displayName: string };
};

type VaultResult = { state: VaultState; error?: never } | { state?: never; error: string };

export async function getVaultUser(clerkId: string) {
  return getUserByClerkId(clerkId);
}

async function stateFor(userId: string, displayName: string): Promise<VaultState> {
  const db = getDb();
  const [balanceRow] = await db
    .select({ balance: sql<number>`coalesce(sum(${tokenLedger.amount}), 0)` })
    .from(tokenLedger)
    .where(eq(tokenLedger.userId, userId));
  const rows = await db
    .select()
    .from(gameMissionProgress)
    .where(and(eq(gameMissionProgress.userId, userId), eq(gameMissionProgress.gameId, CYBERVERSE_GAME_ID)));
  const xp = rows.reduce((sum, row) => sum + row.xpAwarded, 0);
  const achievements = rows.flatMap((row) =>
    Array.isArray(row.achievements) ? (row.achievements as string[]) : [],
  );
  return {
    mode: 'production',
    tokens: Math.max(0, Number(balanceRow?.balance ?? 0)),
    xp,
    unlocked: rows.map((row) => row.missionId),
    completed: rows.filter((row) => row.completedAt !== null).map((row) => row.missionId),
    achievements: [...new Set(achievements)],
    student: { id: userId, displayName },
  };
}

export async function contextFor(clerkId: string) {
  const user = await getVaultUser(clerkId);
  if (!user) return null;
  return stateFor(user.id, user.email.split('@')[0] || 'Student');
}

export async function unlockMission(clerkId: string, missionId: string): Promise<VaultResult> {
  const user = await getVaultUser(clerkId);
  if (!user) return { error: 'not_found' as const };
  if (!isCyberverseMission(missionId)) return { error: 'mission_not_found' as const };
  const mission = CYBERVERSE_MISSIONS[missionId];
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${user.id} for update`);
    const [existing] = await tx
      .select()
      .from(gameMissionProgress)
      .where(
        and(
          eq(gameMissionProgress.userId, user.id),
          eq(gameMissionProgress.gameId, CYBERVERSE_GAME_ID),
          eq(gameMissionProgress.missionId, missionId),
        ),
      )
      .limit(1);
    if (existing) return 'already_owned' as const;
    const [balance] = await tx
      .select({ value: sql<number>`coalesce(sum(${tokenLedger.amount}), 0)` })
      .from(tokenLedger)
      .where(eq(tokenLedger.userId, user.id));
    if (Number(balance?.value ?? 0) < mission.cost) return 'insufficient_tokens' as const;
    const [entitlement] = await tx
      .insert(gameMissionProgress)
      .values({ userId: user.id, gameId: CYBERVERSE_GAME_ID, missionId })
      .returning({ id: gameMissionProgress.id });
    if (!entitlement) throw new Error('Mission entitlement was not written');
    await tx
      .insert(tokenLedger)
      .values({
        userId: user.id,
        amount: -mission.cost,
        reason: `game_unlock:${CYBERVERSE_GAME_ID}:${missionId}`,
        refId: entitlement.id,
      });
    return 'unlocked' as const;
  });
  if (result === 'insufficient_tokens') return { error: result };
  return { state: await stateFor(user.id, user.email.split('@')[0] || 'Student') };
}

export async function completeMission(
  clerkId: string,
  missionId: string,
  evidence: unknown,
): Promise<VaultResult> {
  const user = await getVaultUser(clerkId);
  if (!user) return { error: 'not_found' as const };
  if (!isCyberverseMission(missionId)) return { error: 'mission_not_found' as const };
  if (missionId !== 'binary_city' || !validBinaryEvidence(evidence))
    return { error: 'completion_rejected' as const };
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${user.id} for update`);
    const [row] = await tx
      .select()
      .from(gameMissionProgress)
      .where(
        and(
          eq(gameMissionProgress.userId, user.id),
          eq(gameMissionProgress.gameId, CYBERVERSE_GAME_ID),
          eq(gameMissionProgress.missionId, missionId),
        ),
      )
      .limit(1);
    if (!row) return 'mission_locked' as const;
    if (row.completedAt) return 'already_completed' as const;
    await tx
      .update(gameMissionProgress)
      .set({
        completedAt: new Date(),
        xpAwarded: CYBERVERSE_MISSIONS[missionId].xp,
        achievements: ['first_transmission'],
      })
      .where(eq(gameMissionProgress.id, row.id));
    return 'completed' as const;
  });
  if (result === 'mission_locked') return { error: result };
  return { state: await stateFor(user.id, user.email.split('@')[0] || 'Student') };
}
