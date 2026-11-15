import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getUserByClerkId } from '@/lib/users';

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const clerkUser = await currentUser();
  const dbUser = await getUserByClerkId(userId);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <p className="mt-2 text-neutral-600">Signed in as {clerkUser?.primaryEmailAddress?.emailAddress}</p>
      <dl className="mt-6 space-y-2 rounded border p-4 text-sm">
        <div className="flex gap-2">
          <dt className="w-32 font-medium text-neutral-500">Clerk id</dt>
          <dd className="font-mono">{userId}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-32 font-medium text-neutral-500">App user id</dt>
          <dd className="font-mono">{dbUser?.id ?? 'not synced yet'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-32 font-medium text-neutral-500">AI quota used</dt>
          <dd>{dbUser?.dailyAiQuotaUsed ?? 0} / today</dd>
        </div>
      </dl>
    </main>
  );
}
