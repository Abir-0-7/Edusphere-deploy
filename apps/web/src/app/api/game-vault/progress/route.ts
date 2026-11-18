import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { CyberverseProgressInputSchema, CyberverseResponseSchema } from '@studyvault/types';
import { errorBody } from '@/lib/errors';
import { hasSameOrigin } from '@/lib/request-origin';
import { gameRequestBody } from '@/lib/game-session-state';
import { completeMission } from '@/lib/game-vault/server';
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
      return NextResponse.json(errorBody('unauthorized', 'Sign in to save a mission completion.'), {
        status: 401,
        headers: VAULT_HEADERS,
      });
    const parsed = CyberverseProgressInputSchema.safeParse(await gameRequestBody(request));
    if (!parsed.success)
      return NextResponse.json(errorBody('invalid_input', 'Invalid mission completion request.'), {
        status: 400,
        headers: VAULT_HEADERS,
      });
    const result = await completeMission(userId, parsed.data.missionId, parsed.data.evidence);
    return result.error
      ? vaultFailure(result.error)
      : NextResponse.json(CyberverseResponseSchema.parse({ ok: true, state: result.state }), {
          headers: VAULT_HEADERS,
        });
  } catch {
    return vaultUnavailable();
  }
}
