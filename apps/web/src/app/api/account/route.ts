import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { errorBody } from '@/lib/errors';
import { hasSameOrigin } from '@/lib/request-origin';

/** Permanently removes the Clerk identity. The signed Clerk `user.deleted`
 * webhook removes the matching app row and its cascading study data. */
export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(errorBody('forbidden', 'same-origin request required'), { status: 403 });
  }
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(errorBody('sign in required', 'unauthorized'), { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('confirmation' in body) || body.confirmation !== 'DELETE') {
    return NextResponse.json(errorBody('type DELETE to confirm account deletion', 'invalid_input'), {
      status: 400,
    });
  }

  const client = await clerkClient();
  await client.users.deleteUser(userId);
  return NextResponse.json({ deleted: true });
}
