'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useFocusSession } from './focus-session-provider';

export function GameVaultLink({
  children,
  className,
  current,
  lockedLabel = false,
}: {
  children: ReactNode;
  className: string;
  current?: boolean;
  lockedLabel?: boolean;
}) {
  const { gameVaultAccess } = useFocusSession();
  if (gameVaultAccess === 'open') {
    return (
      <Link href="/games" className={className} aria-current={current ? 'page' : undefined}>
        {children}
      </Link>
    );
  }

  const active = gameVaultAccess === 'locked';
  return (
    <span
      role="link"
      aria-disabled="true"
      aria-current={current ? 'page' : undefined}
      className={`${className} cursor-not-allowed opacity-65`}
      title={active ? 'Available when your focus session ends' : 'Checking focus status'}
    >
      {children}
      {lockedLabel && active && <small> Locked</small>}
    </span>
  );
}
