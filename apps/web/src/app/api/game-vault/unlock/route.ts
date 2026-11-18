import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { CyberverseResponseSchema, CyberverseUnlockInputSchema } from '@studyvault/types';
import { errorBody } from '@/lib/errors';
import { hasSameOrigin } from '@/lib/request-origin';
import { gameRequestBody } from '@/lib/game-session-state';
import { unlockMission } from '@/lib/game-vault/server';
import { VAULT_HEADERS, vaultFailure, vaultUnavailable } from '@/lib/game-vault/responses';

export async function POST(request: Request) {
  if (!hasSameOrigin(request))
    return NextResponse.json(errorBody('unauthorized', 'A same-origin request is required.'), {
      status: 403,
      headers: VAULT_HEADERS,
    });
  try {
    const { userId } = await auth();
    if (!userId)
      return NextResponse.json(errorBody('unauthorized', 'Sign in to unlock a mission.'), {
        status: 401,
        headers: VAULT_HEADERS,
      });
    const parsed = CyberverseUnlockInputSchema.safeParse(await gameRequestBody(request));
    if (!parsed.success)
      return NextResponse.json(errorBody('invalid_input', 'Invalid mission unlock request.'), {
        status: 400,
        headers: VAULT_HEADERS,
      });
    const result = await unlockMission(userId, parsed.data.missionId);
    return result.error
      ? vaultFailure(result.error)
      : NextResponse.json(CyberverseResponseSchema.parse({ ok: true, state: result.state }), {
          headers: VAULT_HEADERS,
        });
  } catch {
    return vaultUnavailable();
  }
}
