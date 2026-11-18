import { and, eq, sql } from 'drizzle-orm';
import { gameMissionProgress, tokenLedger, users } from '@studyvault/db';
import { CyberverseMissionSchema, CyberverseStateSchema } from '@studyvault/types';
import { getDb } from '@/lib/db';
import {
  CYBERVERSE_BINARY_CITY_COST,
  CYBERVERSE_BINARY_CITY_XP,
  CYBERVERSE_GAME_ID,
  validBinaryEvidence,
} from './mission-rules';

type VaultDatabase = ReturnType<typeof getDb>;
export type VaultState = ReturnType<typeof CyberverseStateSchema.parse>;
export type VaultError =
  | 'not_found'
  | 'mission_not_found'
  | 'mission_not_playable'
  | 'insufficient_tokens'
  | 'mission_locked'
  | 'completion_rejected';
export type VaultResult = { state: VaultState; error?: never } | { state?: never; error: VaultError };

async function stateFor(executor: Pick<VaultDatabase, 'select'>, userId: string): Promise<VaultState> {
  const [balance] = await executor
    .select({ value: sql<string>`coalesce(sum(${tokenLedger.amount}), 0)` })
    .from(tokenLedger)
    .where(eq(tokenLedger.userId, userId));
  const rows = await executor
    .select()
    .from(gameMissionProgress)
    .where(and(eq(gameMissionProgress.userId, userId), eq(gameMissionProgress.gameId, CYBERVERSE_GAME_ID)))
    .limit(CyberverseMissionSchema.options.length);
  return CyberverseStateSchema.parse({
    mode: 'production',
    tokens: Math.max(0, Number(balance?.value ?? 0)),
    xp: rows.reduce((sum, row) => sum + row.xpAwarded, 0),
    unlocked: rows.map((row) => row.missionId),
    completed: rows.filter((row) => row.completedAt !== null).map((row) => row.missionId),
    achievements: [
      ...new Set(rows.flatMap((row) => (Array.isArray(row.achievements) ? row.achievements : []))),
    ],
    student: { id: userId, displayName: 'Student Explorer' },
  });
}

/** All spending and entitlement changes lock the same account row before reading
 * balance. The shared ledger and the permanent entitlement commit together. */
export function createGameVaultService(database: VaultDatabase) {
  return {
    async contextFor(clerkId: string): Promise<VaultState | null> {
      return database.transaction(async (tx) => {
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.clerkId, clerkId))
          .for('key share');
        return owner ? stateFor(tx, owner.id) : null;
      });
    },
    async unlockMission(clerkId: string, missionId: string): Promise<VaultResult> {
      if (!CyberverseMissionSchema.safeParse(missionId).success) return { error: 'mission_not_found' };
      if (missionId !== 'binary_city') return { error: 'mission_not_playable' };
      return database.transaction(async (tx): Promise<VaultResult> => {
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.clerkId, clerkId))
          .for('update');
        if (!owner) return { error: 'not_found' };
        const [existing] = await tx
          .select({ id: gameMissionProgress.id })
          .from(gameMissionProgress)
          .where(
            and(
              eq(gameMissionProgress.userId, owner.id),
              eq(gameMissionProgress.gameId, CYBERVERSE_GAME_ID),
              eq(gameMissionProgress.missionId, missionId),
            ),
          )
          .limit(1);
        if (existing) return { state: await stateFor(tx, owner.id) };
        const [balance] = await tx
          .select({ value: sql<string>`coalesce(sum(${tokenLedger.amount}), 0)` })
          .from(tokenLedger)
          .where(eq(tokenLedger.userId, owner.id));
        const available = Number(balance?.value ?? 0);
        if (!Number.isSafeInteger(available)) throw new Error('invalid account token balance');
        if (available < CYBERVERSE_BINARY_CITY_COST) return { error: 'insufficient_tokens' };
        const [entitlement] = await tx
          .insert(gameMissionProgress)
          .values({
            userId: owner.id,
            gameId: CYBERVERSE_GAME_ID,
            missionId,
          })
          .returning({ id: gameMissionProgress.id });
        if (!entitlement) throw new Error('mission entitlement was not written');
        await tx.insert(tokenLedger).values({
          userId: owner.id,
          amount: -CYBERVERSE_BINARY_CITY_COST,
          reason: `game_unlock:${CYBERVERSE_GAME_ID}:${missionId}`,
          refId: owner.id,
        });
        return { state: await stateFor(tx, owner.id) };
      });
    },
    async completeMission(clerkId: string, missionId: string, evidence: unknown): Promise<VaultResult> {
      if (!CyberverseMissionSchema.safeParse(missionId).success) return { error: 'mission_not_found' };
      if (missionId !== 'binary_city') return { error: 'mission_not_playable' };
      if (!validBinaryEvidence(evidence)) return { error: 'completion_rejected' };
      return database.transaction(async (tx): Promise<VaultResult> => {
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.clerkId, clerkId))
          .for('update');
        if (!owner) return { error: 'not_found' };
        const [row] = await tx
          .select()
          .from(gameMissionProgress)
          .where(
            and(
              eq(gameMissionProgress.userId, owner.id),
              eq(gameMissionProgress.gameId, CYBERVERSE_GAME_ID),
              eq(gameMissionProgress.missionId, missionId),
            ),
          )
          .limit(1);
        if (!row) return { error: 'mission_locked' };
        if (!row.completedAt) {
          await tx
            .update(gameMissionProgress)
            .set({
              completedAt: new Date(),
              xpAwarded: CYBERVERSE_BINARY_CITY_XP,
              achievements: ['first_transmission'],
            })
            .where(and(eq(gameMissionProgress.id, row.id), eq(gameMissionProgress.userId, owner.id)));
        }
        return { state: await stateFor(tx, owner.id) };
      });
    },
  };
}

export const contextFor = (clerkId: string) => createGameVaultService(getDb()).contextFor(clerkId);
export const unlockMission = (clerkId: string, missionId: string) =>
  createGameVaultService(getDb()).unlockMission(clerkId, missionId);
export const completeMission = (clerkId: string, missionId: string, evidence: unknown) =>
  createGameVaultService(getDb()).completeMission(clerkId, missionId, evidence);
