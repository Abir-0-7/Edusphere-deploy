import { auth } from '@clerk/nextjs/server';
import { createHash, createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { BattleService, Judge0Client, type Language } from '@studyvault/code-runner';
import { CodeChallengeGradeSchema, CodeChallengeRequestSchema } from '@studyvault/types';
import { errorBody } from '@/lib/errors';
import { getEnv } from '@/env';
import { getUserByClerkId } from '@/lib/users';

let battleService: BattleService | undefined;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json(errorBody('sign in required', 'unauthorized'), { status: 401 });
  if (!(await getUserByClerkId(userId)))
    return NextResponse.json(errorBody('user not found', 'not_found'), { status: 404 });
  const input = CodeChallengeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(errorBody('invalid battle submission', 'invalid_input'), { status: 400 });
  const env = getEnv();
  if (!env.JUDGE0_BASE_URL)
    return NextResponse.json(errorBody('code runner is not configured', 'internal'), { status: 503 });
  if (input.data.courseContext && !env.COURSE_LAB_RECEIPT_SECRET) {
    return NextResponse.json(errorBody('course coding progress is not configured', 'internal'), {
      status: 503,
    });
  }
  try {
    battleService ??= new BattleService(
      new Judge0Client({ baseUrl: env.JUDGE0_BASE_URL, apiKey: env.JUDGE0_API_KEY }),
    );
    const result = await battleService.submit({
      userId,
      problemId: input.data.problemId,
      language: input.data.language as Language,
      source: input.data.source,
    });
    const grade = CodeChallengeGradeSchema.parse(result.grade);
    const context = input.data.courseContext;
    const courseReceipt =
      context && grade.passed === grade.total
        ? createCourseReceipt(env.COURSE_LAB_RECEIPT_SECRET!, {
            enrollmentId: context.enrollmentId,
            labId: context.labId,
            taskId: context.taskId,
            problemId: input.data.problemId,
            language: input.data.language,
            source: input.data.source,
          })
        : undefined;
    return NextResponse.json({ ...grade, ...(courseReceipt ? { courseReceipt } : {}) });
  } catch {
    return NextResponse.json(errorBody('code execution failed', 'internal'), { status: 502 });
  }
}

function createCourseReceipt(
  secret: string,
  fields: {
    enrollmentId: string;
    labId: string;
    taskId: string;
    problemId: string;
    language: 'python' | 'javascript';
    source: string;
  },
): string {
  const expires = Math.floor(Date.now() / 1000) + 120;
  const sourceHash = createHash('sha256').update(fields.source, 'utf8').digest('hex');
  const claims = [
    String(expires),
    fields.enrollmentId,
    fields.labId,
    fields.taskId,
    fields.problemId,
    fields.language,
    sourceHash,
  ].join('\n');
  const signature = createHmac('sha256', secret).update(claims, 'utf8').digest('hex');
  return `${expires}.${sourceHash}.${signature}`;
}
