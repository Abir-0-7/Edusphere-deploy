import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getUserDocuments, type UserDocument } from '@/lib/documents';
import { LibraryWorkspace } from './library-workspace';

export const metadata = { title: 'My library | EduSphere' };

export default async function LibraryPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  let initialDocuments: UserDocument[] = [];
  let userSynced = false;
  let loadError = '';
  try {
    const result = await getUserDocuments(userId);
    userSynced = result !== null;
    initialDocuments = result ?? [];
  } catch {
    loadError = 'Your library could not be loaded right now. Try refreshing the page.';
  }

  return (
    <LibraryWorkspace
      initialDocuments={initialDocuments}
      loadError={loadError}
      userSynced={userSynced}
    />
  );
}
