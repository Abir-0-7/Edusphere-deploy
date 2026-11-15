import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BattleService, Judge0Client, type Language } from '@studyvault/code-runner';
import { errorBody } from '@/lib/errors';
import { getEnv } from '@/env';
import { getUserByClerkId } from '@/lib/users';

const SubmitSchema = z.object({ problemId: z.enum(['sum-pairs', 'reverse-words']), language: z.enum(['python', 'javascript']), source: z.string().min(1).max(20_000) });
let battleService: BattleService | undefined;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json(errorBody('sign in required', 'unauthorized'), { status: 401 });
  if (!await getUserByClerkId(userId)) return NextResponse.json(errorBody('user not found', 'not_found'), { status: 404 });
  const input = SubmitSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json(errorBody('invalid battle submission', 'invalid_input'), { status: 400 });
  const env = getEnv();
  if (!env.JUDGE0_BASE_URL) return NextResponse.json(errorBody('code runner is not configured', 'internal'), { status: 503 });
  try {
    battleService ??= new BattleService(new Judge0Client({ baseUrl: env.JUDGE0_BASE_URL, apiKey: env.JUDGE0_API_KEY }));
    const result = await battleService.submit({ userId, problemId: input.data.problemId, language: input.data.language as Language, source: input.data.source });
    return NextResponse.json(result.grade);
  } catch {
    return NextResponse.json(errorBody('code execution failed', 'internal'), { status: 502 });
  }
}
