import type { ReactNode } from 'react';
import { GameVaultFocusGate } from '@/components/game-vault-focus-gate';

export default function GamesLayout({ children }: { children: ReactNode }) {
  return <GameVaultFocusGate>{children}</GameVaultFocusGate>;
}
