import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasSameOrigin } from '@/lib/request-origin';
import { completeMission } from '@/lib/game-vault/server';
import { isLocalDemoRequest } from '@/lib/local-demo';

const Input = z.object({
  gameId: z.literal('cyberverse'),
  missionId: z.string().min(1).max(64),
  evidence: z.unknown(),
  requestId: z.string().min(1).max(128),
});
export async function POST(request: Request) {
  if (isLocalDemoRequest(request))
    return NextResponse.json({ ok: false, error: 'local_demo_client_only' }, { status: 403 });
  if (!hasSameOrigin(request)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 });
  try {
    const result = await completeMission(userId, parsed.data.missionId, parsed.data.evidence);
    return result.error
      ? NextResponse.json(
          { ok: false, error: result.error },
          {
            status:
              result.error === 'mission_locked' ? 409 : result.error === 'completion_rejected' ? 422 : 404,
          },
        )
      : NextResponse.json({ ok: true, missionId: parsed.data.missionId, state: result.state });
  } catch {
    return NextResponse.json({ ok: false, error: 'service_unavailable' }, { status: 503 });
  }
}
