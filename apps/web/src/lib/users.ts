import { eq } from 'drizzle-orm';
import { users } from '@studyvault/db';
import { getDb } from '@/lib/db';

/**
 * Idempotent user sync (task 1.9): insert if absent, update email if present.
 * Replaying the same Clerk webhook event never duplicates the row.
 */
export async function upsertUserByClerkId(clerkId: string, email: string) {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({ clerkId, email })
    .onConflictDoUpdate({ target: users.clerkId, set: { email, updatedAt: new Date() } })
    .returning();
  return row;
}

export async function deleteUserByClerkId(clerkId: string) {
  const db = getDb();
  await db.delete(users).where(eq(users.clerkId, clerkId));
}

export async function getUserByClerkId(clerkId: string) {
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return row ?? null;
}
