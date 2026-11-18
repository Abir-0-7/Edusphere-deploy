import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { CyberverseResponseSchema, CYBERVERSE_GAME_ID } from '@studyvault/types';
import { errorBody } from '@/lib/errors';
import { contextFor } from '@/lib/game-vault/server';
import { VAULT_HEADERS, vaultFailure, vaultUnavailable } from '@/lib/game-vault/responses';

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId)
      return NextResponse.json(errorBody('unauthorized', 'Sign in to open Game Vault.'), {
        status: 401,
        headers: VAULT_HEADERS,
      });
    if (new URL(request.url).searchParams.get('gameId') !== CYBERVERSE_GAME_ID)
      return vaultFailure('mission_not_found');
    const state = await contextFor(userId);
    if (!state) return vaultFailure('not_found');
    return NextResponse.json(CyberverseResponseSchema.parse({ ok: true, state }), { headers: VAULT_HEADERS });
  } catch {
    return vaultUnavailable();
  }
}
