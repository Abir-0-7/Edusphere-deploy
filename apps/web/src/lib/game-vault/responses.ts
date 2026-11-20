import { NextResponse } from 'next/server';
import { errorBody } from '@/lib/errors';
import { GAME_FOCUS_LOCK_MESSAGE } from '@/lib/game-focus-lock';
import type { VaultError } from './server';

export const VAULT_HEADERS = { 'Cache-Control': 'no-store' };

export function vaultFailure(reason: VaultError) {
  const errors: Record<VaultError, { status: number; code: string; message: string }> = {
    focus_active: { status: 409, code: 'conflict', message: GAME_FOCUS_LOCK_MESSAGE },
    not_found: { status: 404, code: 'not_found', message: 'StudyVault account not found.' },
    mission_not_found: { status: 404, code: 'not_found', message: 'Mission not found.' },
    mission_not_playable: {
      status: 409,
      code: 'invalid_input',
      message: 'This mission is a preview and cannot be unlocked. No tokens were charged.',
    },
    insufficient_tokens: {
      status: 409,
      code: 'invalid_input',
      message: 'Binary City needs 5 StudyVault tokens for its one-time unlock.',
    },
    mission_locked: {
      status: 409,
      code: 'invalid_input',
      message: 'Unlock Binary City before saving a completion.',
    },
    completion_rejected: {
      status: 422,
      code: 'invalid_input',
      message: 'The Binary City completion could not be verified.',
    },
  };
  const error = errors[reason];
  return NextResponse.json(errorBody(error.code, error.message), {
    status: error.status,
    headers: VAULT_HEADERS,
  });
}

export function vaultUnavailable() {
  return NextResponse.json(errorBody('internal', 'Game Vault is temporarily unavailable. Please retry.'), {
    status: 503,
    headers: VAULT_HEADERS,
  });
}
