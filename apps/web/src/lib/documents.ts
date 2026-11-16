import 'server-only';

import { desc, eq } from 'drizzle-orm';
import { documents } from '@studyvault/db';
import { getDb } from '@/lib/db';
import { getUserByClerkId } from '@/lib/users';

export type UserDocument = {
  id: string;
  filename: string;
  status: string;
  pageCount: number | null;
  updatedAt: Date;
};

/** Returns null until Clerk's user row is synced; document queries always use the internal user ID. */
export async function getUserDocuments(clerkUserId: string): Promise<UserDocument[] | null> {
  const user = await getUserByClerkId(clerkUserId);
  if (!user) return null;

  return getDb()
    .select({
      id: documents.id,
      filename: documents.filename,
      status: documents.status,
      pageCount: documents.pageCount,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(eq(documents.userId, user.id))
    .orderBy(desc(documents.updatedAt));
}
