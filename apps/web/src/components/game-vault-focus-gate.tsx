'use client';

import type { ReactNode } from 'react';
import { useFocusSession } from './focus-session-provider';

export function GameVaultFocusGate({ children }: { children: ReactNode }) {
  const { gameVaultAccess } = useFocusSession();
  if (gameVaultAccess === 'open') return children;

  const locked = gameVaultAccess === 'locked';
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm" role="status">
        <h1 className="text-2xl font-bold text-slate-950">
          {locked ? 'Game Vault is locked' : 'Game Vault'}
        </h1>
        <p className="mt-2 text-slate-700">
          {locked && 'Game Vault will unlock when your focus session ends.'}
          {gameVaultAccess === 'checking' && 'Checking for an active focus session…'}
          {gameVaultAccess === 'unavailable' && 'Retry the focus session check above to open Game Vault.'}
        </p>
      </div>
    </main>
  );
}
