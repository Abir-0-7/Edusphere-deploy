import { gameMenuEntries } from '@/lib/game-catalog';
import { GameTokenBalance } from '@/components/game-token-balance';

export function GamesMenu() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 max-w-2xl space-y-3">
        <p className="text-sm font-semibold tracking-wide text-blue-800">EduSphere practice</p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Game Vault</h1>
        <p className="text-slate-700">
          Work through a puzzle or practise Python. Pick a game to see its rules and resume your saves.
        </p>
        <GameTokenBalance />
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gameMenuEntries.map((game) => (
          <article
            key={game.id}
            className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-900">
                {game.category}
              </span>
              <span aria-hidden="true" className="font-mono text-sm font-bold text-slate-500">
                {game.marker}
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-950">{game.title}</h2>
            <p className="mt-2 flex-1 text-sm text-slate-700">{game.objective}</p>
            <p className="mt-3 text-xs font-medium text-slate-600">{game.access}</p>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-slate-600">{game.duration}</span>
              <a
                href={game.href}
                className="rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              >
                Open <span className="sr-only">{game.title}</span>
              </a>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
