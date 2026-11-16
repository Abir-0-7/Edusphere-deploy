const games = [
  { name: 'Sorting Race', detail: 'Arrange the sequence in order.' },
  { name: 'N-Queens', detail: 'Place queens without conflicts.' },
  { name: 'Towers of Hanoi', detail: 'Move the stack to its final tower.' },
  { name: 'Flashcard Tower Defense', detail: 'Answer study prompts to defend each lane.' },
];

export const metadata = { title: 'Games | EduSphere' };

export default function GamesPage() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-5 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase text-emerald-700">Game Vault</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Learning games</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Short challenges for logic, problem solving, and flashcard recall.
          </p>
        </div>
        <a
          href="/games/index.html"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 items-center justify-center rounded border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Open full screen
        </a>
      </header>

      <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        {games.map((game) => (
          <li key={game.name} className="border-l-2 border-emerald-600 pl-3">
            <h2 className="text-sm font-semibold text-slate-900">{game.name}</h2>
            <p className="mt-1 text-sm text-slate-600">{game.detail}</p>
          </li>
        ))}
      </ul>

      <p className="text-sm text-slate-600 sm:hidden">
        On a phone, open full screen and rotate to landscape for larger controls.
      </p>

      <iframe
        title="EduSphere Game Vault"
        src="/games/index.html"
        loading="lazy"
        className="h-[min(68vh,680px)] min-h-[450px] w-full rounded border border-slate-300 bg-slate-950"
      />
    </main>
  );
}
