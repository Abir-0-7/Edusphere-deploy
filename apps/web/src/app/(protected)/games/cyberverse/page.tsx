import { CyberversePlayer } from '@/components/cyberverse-player';

export default function CyberversePage() {
  return (
    <main className="coast-cyberverse-page mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6">
      <a href="/games" className="text-sm font-semibold text-blue-800 underline">
        All games
      </a>
      <h1 className="text-3xl font-bold">Cyberverse</h1>
      <p>
        Explore Binary City and solve binary and hexadecimal puzzles. Unlock the mission once and replay it
        for free.
      </p>
      <p className="text-sm text-slate-700">
        On desktop, click into the game to focus it and press P to pause and release the mouse. On touch
        screens, use the on-screen controls.
      </p>
      <CyberversePlayer />
    </main>
  );
}
