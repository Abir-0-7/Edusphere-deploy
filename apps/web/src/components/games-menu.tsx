import { gameMenuEntries } from '@/lib/game-catalog';
import { GameTokenBalance } from '@/components/game-token-balance';

const ACCENTS = [
  'from-amber-400 to-orange-500',
  'from-emerald-400 to-teal-600',
  'from-sky-400 to-blue-600',
  'from-violet-400 to-fuchsia-600',
  'from-rose-400 to-pink-600',
  'from-cyan-400 to-sky-600',
  'from-lime-400 to-emerald-600',
  'from-indigo-400 to-violet-600',
];

function GamePreview({ gameId }: { gameId: string }) {
  const common = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  return (
    <svg data-game-preview={gameId} aria-hidden="true" viewBox="0 0 96 64" className="h-16 w-24 shrink-0">
      {gameId === 'SortingRace' && (
        <g {...common}>
          {[0, 1, 2, 3].map((index) => (
            <g key={index} transform={`translate(${4 + index * 22} 11)`}>
              <rect
                width="18"
                height="29"
                rx="5"
                fill={['#fcd34d', '#fb923c', '#fde68a', '#f97316'][index]}
              />
              <text x="9" y="20" textAnchor="middle" fill="#713f12" fontSize="12" fontWeight="800">
                {[3, 1, 4, 2][index]}
              </text>
            </g>
          ))}
          <path d="M16 50h62m-7-6 7 6-7 6" fill="none" stroke="#b45309" strokeWidth="3" />
        </g>
      )}
      {gameId === 'NQueens' && (
        <g>
          {Array.from({ length: 16 }, (_, index) => (
            <rect
              key={index}
              x={20 + (index % 4) * 14}
              y={4 + Math.floor(index / 4) * 14}
              width="14"
              height="14"
              fill={(Math.floor(index / 4) + (index % 4)) % 2 ? '#315d50' : '#e4eadf'}
            />
          ))}
          <g fill="#d99b35">
            <path d="m27 15 3 3 2-7 2 7 3-5 2 7H26l1-5Z" />
            <path d="m41 29 3 3 2-7 2 7 3-5 2 7H40l1-5Z" />
            <path d="m55 43 3 3 2-7 2 7 3-5 2 7H54l1-5Z" />
          </g>
        </g>
      )}
      {gameId === 'TowersOfHanoi' && (
        <g {...common} fill="none" stroke="#a16207" strokeWidth="3">
          <path d="M8 54h80M20 54V15m28 39V15m28 39V15" />
          <path d="M12 48h16m13 0h10m9 0h24M16 40h11m14 0h20M20 32h9m11 0h28" strokeWidth="7" />
        </g>
      )}
      {gameId === 'FlashcardTowerDefense' && (
        <g {...common}>
          <path d="M20 51V28l14-13 14 13v23H20Z" fill="#60a5fa" stroke="#1d4ed8" strokeWidth="3" />
          <path d="M29 51V37h10v14M12 54h72" fill="none" stroke="#1e3a8a" strokeWidth="3" />
          <circle cx="68" cy="20" r="8" fill="#fb7185" />
          <circle cx="80" cy="36" r="5" fill="#fbbf24" />
        </g>
      )}
      {gameId === 'ConceptMatch' && (
        <g {...common} fill="none" strokeWidth="3">
          <path d="M29 24c10 5 24 5 36 15" stroke="#7c3aed" strokeDasharray="4 4" />
          <rect x="8" y="12" width="30" height="37" rx="7" fill="#ede9fe" stroke="#8b5cf6" />
          <rect x="58" y="20" width="30" height="37" rx="7" fill="#fae8ff" stroke="#d946ef" />
          <path d="M16 25h14M16 32h10m40 2h14m-14 7h10" stroke="#7c3aed" />
        </g>
      )}
      {gameId === 'RetrievalSprint' && (
        <g {...common}>
          <circle cx="48" cy="34" r="23" fill="#cffafe" stroke="#0891b2" strokeWidth="3" />
          <path d="M48 19v16l11 6M39 5h18M64 12l5-5" fill="none" stroke="#0e7490" strokeWidth="4" />
          <path d="m17 44 6 6 11-12" fill="none" stroke="#0f766e" strokeWidth="3" />
        </g>
      )}
      {gameId === 'CodeTrace' && (
        <g {...common}>
          <rect x="8" y="9" width="80" height="47" rx="8" fill="#172554" />
          <circle cx="17" cy="16" r="2" fill="#fb7185" />
          <circle cx="24" cy="16" r="2" fill="#fbbf24" />
          <circle cx="31" cy="16" r="2" fill="#34d399" />
          <path d="m24 31-7 5 7 5m17-10 7 5-7 5m12 3 9-17" fill="none" stroke="#67e8f9" strokeWidth="3" />
        </g>
      )}
      {gameId === 'DebuggingDetective' && (
        <g {...common} fill="none" stroke="#78350f" strokeWidth="3">
          <circle cx="40" cy="28" r="16" fill="#fef3c7" />
          <path d="m52 40 18 16M35 21l-5 7 5 7m10-14 5 7-5 7" />
          <path d="M12 12h10m45 6h15M8 47h16" stroke="#f59e0b" />
        </g>
      )}
      {gameId === 'SQLDetective' && (
        <g {...common} fill="#dbeafe" stroke="#1e40af" strokeWidth="2">
          <path d="M17 17v30c0 11 62 11 62 0V17" />
          <ellipse cx="48" cy="17" rx="31" ry="10" />
          <path d="M17 31c0 11 62 11 62 0m-62 14c0 11 62 11 62 0" fill="none" />
        </g>
      )}
      {gameId === 'GraphPath' && (
        <g {...common}>
          <path d="m17 40 26-25 32 7-6 29-26-36 0 34-26-9" fill="none" stroke="#075985" strokeWidth="3" />
          {[
            [17, 40],
            [43, 15],
            [75, 22],
            [69, 51],
            [43, 49],
          ].map(([x, y], index) => (
            <circle
              key={index}
              cx={x}
              cy={y}
              r="7"
              fill={index < 3 ? '#0e7490' : '#ecfeff'}
              stroke="#155e75"
              strokeWidth="2"
            />
          ))}
        </g>
      )}
      {gameId === 'ProofBuilder' && (
        <g {...common} fill="#ede9fe" stroke="#5b21b6" strokeWidth="2">
          <rect x="13" y="8" width="57" height="12" rx="4" />
          <rect x="22" y="26" width="57" height="12" rx="4" />
          <rect x="31" y="44" width="57" height="12" rx="4" />
          <path d="m77 11 4 4 8-9M5 30h9m-5-4 5 4-5 4" fill="none" />
        </g>
      )}
      {gameId === 'DataDetective' && (
        <g {...common}>
          <path d="M13 7v48h72" fill="none" stroke="#164e63" strokeWidth="3" />
          {[24, 40, 57, 73].map((x, index) => (
            <rect
              key={x}
              x={x}
              y={[33, 21, 29, 10][index]}
              width="10"
              height={[20, 32, 24, 43][index]}
              rx="3"
              fill={['#0891b2', '#0e7490', '#14b8a6', '#0f766e'][index]}
            />
          ))}
        </g>
      )}
      {gameId === 'AdaptiveQuiz' && (
        <g {...common} fill="none" stroke="#065f46" strokeWidth="3">
          <path d="M13 53V40h21V27h22V14h26m-8-6 8 6-8 6" />
          <circle cx="27" cy="15" r="9" fill="#d1fae5" />
          <path d="M24 13a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1" />
        </g>
      )}
      {gameId === 'ExamEscape' && (
        <g {...common} fill="none" stroke="#92400e" strokeWidth="3">
          <path d="M18 54V8h42v46H18Z" fill="#fffbeb" />
          <path d="m28 54 0-38 24 6v32" fill="#fcd34d" />
          <circle cx="43" cy="37" r="2" fill="#92400e" />
          <path d="M66 31h22m-8-7 8 7-8 7" />
        </g>
      )}
      {gameId === 'Cyberverse' && (
        <g {...common}>
          <path
            d="M7 54V34h15v20m0-29h17v29m0-17h16v17m0-32h16v32m0-19h12v19"
            fill="#312e81"
            stroke="#818cf8"
            strokeWidth="2"
          />
          <path
            d="M13 40h3m12-18h4m-4 8h4m-4 8h4m20 8h4m7-25h5m-5 8h5m18 3h3"
            stroke="#67e8f9"
            strokeWidth="3"
          />
          <path d="M8 55h80" stroke="#c4b5fd" strokeWidth="3" />
        </g>
      )}
    </svg>
  );
}

export function GamesMenu() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-7 sm:px-7 sm:py-10">
      <section className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-[#103f37] via-[#155d4c] to-[#1a765b] px-6 py-7 text-white shadow-[0_24px_60px_-34px_rgba(13,71,55,0.8)] sm:px-9 sm:py-9">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-24 -z-10 h-72 w-72 rounded-full border border-white/10 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.16),transparent_68%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-9rem] right-[18%] -z-10 h-64 w-64 rounded-full border border-white/10"
        />
        <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-50">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-lime-300" />
              EduSphere arcade
            </p>
            <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Game Vault</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-emerald-50/90 sm:text-base">
              Think, explore, and level up. Every game saves your progress so you can pick up right where you
              left off.
            </p>
          </div>
          <div className="min-w-52 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm [&_p]:!text-emerald-50">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-emerald-100/80">
              Your balance
            </p>
            <GameTokenBalance />
          </div>
        </div>
      </section>

      <div className="mb-4 mt-9 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
            Pick your next challenge
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950 sm:text-2xl">
            Explore the collection
          </h2>
        </div>
        <span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 sm:inline-flex">
          Free practice available
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {gameMenuEntries.map((game, index) => (
          <article
            key={game.id}
            className="group relative flex min-h-[242px] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_8px_28px_-22px_rgba(15,23,42,0.48)] motion-safe:transition motion-safe:duration-200 motion-safe:hover:-translate-y-1 hover:border-emerald-800/25 hover:shadow-[0_20px_40px_-24px_rgba(16,80,60,0.38)]"
          >
            <div
              aria-hidden="true"
              className={'absolute inset-x-0 top-0 h-1 bg-gradient-to-r ' + ACCENTS[index % ACCENTS.length]}
            />
            <div className="flex items-start justify-between gap-3">
              <div
                className={
                  'grid min-h-16 min-w-24 place-items-center rounded-2xl bg-gradient-to-br ' +
                  ACCENTS[index % ACCENTS.length] +
                  ' shadow-md shadow-slate-900/10 motion-safe:transition motion-safe:duration-200 motion-safe:group-hover:rotate-[-2deg] motion-safe:group-hover:scale-[1.03]'
                }
              >
                <GamePreview gameId={game.id} />
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600">
                {game.category}
              </span>
            </div>
            <h3 className="mt-5 text-lg font-extrabold tracking-tight text-slate-950">{game.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{game.objective}</p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-500">{game.duration}</p>
                <p className="text-xs font-semibold text-emerald-800">{game.access}</p>
              </div>
              <a
                href={game.href}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white motion-safe:transition group-hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              >
                Play now{' '}
                <span aria-hidden="true" className="font-mono">
                  &gt;
                </span>
                <span className="sr-only"> {game.title}</span>
              </a>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
