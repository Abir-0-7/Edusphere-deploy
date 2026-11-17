import Link from 'next/link';
import { CyberverseBanner } from '@/components/cyberverse-banner';
import { gameVaultCatalog } from '@/lib/game-vault/catalog';

export const metadata = { title: 'Games | EduSphere' };

export default function GamesPage() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-5 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase text-emerald-700">Game Vault</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Choose your next challenge</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Explore a new world or revisit a favorite puzzle. Your existing EduSphere account keeps everything
            connected.
          </p>
        </div>
      </header>

      <ul className="grid gap-6 lg:grid-cols-2">
        {gameVaultCatalog.map((game, index) => (
          <li
            key={game.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
          >
            {game.id === 'cyberverse' ? (
              <div className="relative overflow-hidden bg-slate-950">
                <CyberverseBanner />
                <span className="absolute right-4 top-4 rounded border border-emerald-300/40 bg-slate-950/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-200 sm:right-6 sm:top-6">
                  Game {index + 1}
                </span>
              </div>
            ) : (
              <div className="flex h-44 items-end justify-between bg-emerald-950 p-6 text-amber-200">
                <span className="text-6xl font-light tracking-tighter" aria-hidden="true">
                  {'{ 01 }'}
                </span>
                <span className="rounded border border-current px-3 py-1 text-xs uppercase tracking-wider">
                  Game {index + 1}
                </span>
              </div>
            )}
            <div className="flex flex-1 flex-col p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                {game.category}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">{game.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{game.description}</p>
              {game.platforms.length > 0 && (
                <ul aria-label={`${game.title} supported devices`} className="mt-4 flex flex-wrap gap-2">
                  {game.platforms.map((platform) => (
                    <li
                      key={platform.label}
                      className="inline-flex items-center gap-2 rounded-full border border-cyan-300 bg-slate-950 px-3 py-1 text-xs font-semibold text-cyan-100"
                    >
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_6px_#67e8f9]"
                      />
                      {platform.label}
                      <span className="font-normal text-cyan-200/80">({platform.detail})</span>
                    </li>
                  ))}
                </ul>
              )}
              {game.missions.length > 0 && (
                <p className="mt-4 text-xs font-medium text-slate-600">
                  Individual mission unlocks · {game.missions[0]?.tokens}–
                  {game.missions[game.missions.length - 1]?.tokens} tokens · Free replay
                </p>
              )}
              <Link
                href={`/games/${game.id}`}
                className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-700 px-5 py-2 font-semibold text-white hover:bg-emerald-800"
              >
                Play {game.title}{' '}
                <span aria-hidden="true" className="ml-3">
                  →
                </span>
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-sm text-slate-600">
        CYBERVERSE supports both Desktop (Keyboard + Mouse) and Mobile/Tablet (Touch Controls): touch controls
        appear automatically on touchscreens and can be toggled from the in-game Pause menu. The Logic Arcade
        keeps the original mouse, touch and keyboard puzzles available.
      </p>
    </main>
  );
}
