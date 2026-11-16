import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { documents } from '@studyvault/db';
import { getDb } from '@/lib/db';
import { errorBody } from '@/lib/errors';
import { getUserByClerkId } from '@/lib/users';

/** Download only extracted text owned by the current authenticated user. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(errorBody('unauthorized', 'Sign in to download your document text.'), { status: 401 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(errorBody('invalid_input', 'Invalid document identifier.'), { status: 400 });
  }
  const user = await getUserByClerkId(userId);
  if (!user) {
    return NextResponse.json(errorBody('not_found', 'Document not found.'), { status: 404 });
  }

  const [document] = await getDb()
    .select({ markdown: documents.markdown })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, user.id)))
    .limit(1);
  if (!document) {
    return NextResponse.json(errorBody('not_found', 'Document not found.'), { status: 404 });
  }
  if (!document.markdown?.trim()) {
    return NextResponse.json(errorBody('invalid_input', 'No extracted text is available yet. Wait for PDF processing to finish.'), { status: 409 });
  }

  return new Response(document.markdown, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="edusphere-notes.txt"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
