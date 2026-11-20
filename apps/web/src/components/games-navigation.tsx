'use client';

import { gameMenuEntries } from '@/lib/game-catalog';
import { useFocusSession } from './focus-session-provider';

export function GamesNavigation() {
  const { gameVaultAccess } = useFocusSession();
  if (gameVaultAccess !== 'open') {
    return (
      <span className="px-1 py-1 text-sm text-neutral-600">
        {gameVaultAccess === 'locked' ? 'Games locked' : 'Games'}
      </span>
    );
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer rounded px-1 py-1 text-sm text-neutral-800 hover:underline">
        Games
      </summary>
      <nav
        aria-label="Games menu"
        className="absolute right-0 top-full z-40 mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
      >
        <a
          href="/games"
          className="block rounded px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50"
        >
          All games
        </a>
        {gameMenuEntries.map((game) => (
          <a
            key={game.id}
            href={game.href}
            className="block rounded px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
          >
            {game.title}
          </a>
        ))}
      </nav>
    </details>
  );
}
