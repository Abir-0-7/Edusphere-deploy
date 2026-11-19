'use client';

import { useAuth } from '@clerk/nextjs';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  GameDifficultySchema,
  GameObjectiveSchema,
  type GameCommandInput,
  type GameDifficulty,
  type GameId,
  type GameSession,
  type GameSessionList,
  type OrderedGameAction,
  type VersionedGameAction,
} from '@studyvault/types';
import type { VaultGame } from '@/lib/game-catalog';
import { GameTokenBalance } from '@/components/game-token-balance';
import { GameActivity } from '@/components/game-activity';
import {
  createGameSession,
  deleteGameSession,
  loadGameSession,
  listGameSessions,
  sendGameCommand,
} from '@/lib/game-client';

const OBJECTIVES = [
  { id: 'python.arithmetic', label: 'Python arithmetic' },
  { id: 'python.collections', label: 'Python collections' },
  { id: 'python.iteration', label: 'Python iteration' },
  { id: 'python.branching', label: 'Python branching' },
] as const;

const PREF_KEY = 'studyvault:game-preferences';
const DISK_COLORS = [
  'linear-gradient(90deg,#eab308,#f59e0b)',
  'linear-gradient(90deg,#f97316,#fb7185)',
  'linear-gradient(90deg,#8b5cf6,#6366f1)',
  'linear-gradient(90deg,#0ea5e9,#14b8a6)',
  'linear-gradient(90deg,#22c55e,#10b981)',
];

function QueenMark({ darkSquare }: { darkSquare: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      fill="none"
      className={`h-[70%] w-[70%] drop-shadow-[0_3px_2px_rgba(0,0,0,0.3)] ${darkSquare ? 'text-amber-200' : 'text-amber-700'}`}
    >
      <path d="M8 18 15 25 20 9 24 24 30 12 33 26 41 18 36 38H12L8 18Z" fill="currentColor" />
      <path d="M13 41h23" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="8" cy="15" r="3" fill="currentColor" />
      <circle cx="20" cy="7" r="3" fill="currentColor" />
      <circle cx="31" cy="10" r="3" fill="currentColor" />
      <circle cx="42" cy="15" r="3" fill="currentColor" />
    </svg>
  );
}

function hasPythonObjectives(
  id: GameId,
): id is Extract<GameId, 'FlashcardTowerDefense' | 'ConceptMatch' | 'RetrievalSprint' | 'CodeTrace'> {
  return (
    id === 'FlashcardTowerDefense' || id === 'ConceptMatch' || id === 'RetrievalSprint' || id === 'CodeTrace'
  );
}

function isQuestionGame(id: GameId): boolean {
  return id !== 'SortingRace' && id !== 'NQueens' && id !== 'TowersOfHanoi';
}

function actionFor(session: GameSession, action: VersionedGameAction): OrderedGameAction {
  return { seq: session.snapshot.actions.length + 1, action };
}

export function GameVault({ game }: { game: VaultGame }) {
  const { isLoaded, userId } = useAuth();
  if (!isLoaded || !userId) return <p role="status">Loading your game account.</p>;
  return <AccountGameVault key={`${userId}:${game.id}`} game={game} />;
}

function AccountGameVault({ game }: { game: VaultGame }) {
  const player = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<GameSessionList | null>(null);
  const [selected, setSelected] = useState<GameSession | null>(null);
  const [difficulty, setDifficulty] = useState<GameDifficulty>(game.difficulties[0] ?? 'easy');
  const [practice, setPractice] = useState(false);
  const [objectiveId, setObjectiveId] = useState<string>('');
  // Keep save controls disabled until the initial session list settles.
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [sound, setSound] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  const refresh = useCallback(async (clearError = true) => {
    setBusy(true);
    try {
      const next = await listGameSessions();
      setList(next);
      if (clearError) setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load game sessions.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
      if (typeof saved === 'object' && saved !== null) {
        if ('sound' in saved && typeof saved.sound === 'boolean') setSound(saved.sound);
        if ('reducedMotion' in saved && typeof saved.reducedMotion === 'boolean') {
          setReducedMotion(saved.reducedMotion);
        } else {
          setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        }
      } else {
        setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      }
    } catch {
      // Preferences are optional; the player remains usable with defaults.
    } finally {
      setPreferencesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ sound, reducedMotion }));
    } catch {
      setError('Browser storage is unavailable. Your game saves on the server, but preferences may reset.');
    }
  }, [preferencesLoaded, sound, reducedMotion]);

  const state = selected?.view ?? null;
  const question = state?.question ?? null;
  const savedGames = list?.sessions.filter((session) => session.snapshot.config.game_id === game.id) ?? [];

  const run = async (command: GameCommandInput) => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await sendGameCommand(selected.id, command);
      setSelected(next);
      setSelectedIndex(null);
      setList((previous) =>
        previous
          ? {
              ...previous,
              sessions: previous.sessions.map((item) => (item.id === next.id ? next : item)),
              progression:
                next.status === 'won' && selected.status !== 'won'
                  ? {
                      ...previous.progression,
                      [next.snapshot.config.game_id]: previous.progression[next.snapshot.config.game_id] + 1,
                    }
                  : previous.progression,
            }
          : previous,
      );
      if (sound && typeof window !== 'undefined' && 'AudioContext' in window) {
        try {
          const context = new AudioContext();
          const oscillator = context.createOscillator();
          oscillator.frequency.value = 520;
          oscillator.connect(context.destination);
          oscillator.addEventListener('ended', () => void context.close());
          oscillator.start();
          oscillator.stop(context.currentTime + (reducedMotion ? 0.03 : 0.08));
        } catch {
          // Audio is an optional preference and never blocks a saved game action.
          setSound(false);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That action could not be saved. Try again.');
      try {
        setSelected(await loadGameSession(selected.id));
      } catch {
        // Keep the last board visible when both the action and recovery request fail.
      }
      void refresh(false);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await createGameSession({
        game_id: game.id,
        difficulty,
        practice,
        ...(hasPythonObjectives(game.id) && objectiveId
          ? { objective_id: GameObjectiveSchema.parse(objectiveId) }
          : {}),
      });
      setSelected(next);
      setList((previous) => (previous ? { ...previous, sessions: [next, ...previous.sessions] } : previous));
      setSelectedIndex(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the game.');
    } finally {
      setBusy(false);
    }
  };

  const retryAsNewSession = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await createGameSession({
        game_id: selected.snapshot.config.game_id,
        difficulty: selected.snapshot.config.difficulty,
        practice: selected.snapshot.config.practice,
        ...(selected.snapshot.config.objective_id
          ? { objective_id: selected.snapshot.config.objective_id }
          : {}),
      });
      setSelected(next);
      setList((previous) => (previous ? { ...previous, sessions: [next, ...previous.sessions] } : previous));
      setSelectedIndex(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start a retry session.');
    } finally {
      setBusy(false);
    }
  };

  const act = (action: VersionedGameAction) => {
    if (!selected || selected.status !== 'playing') return;
    if (action.type === 'move' && selected.snapshot.config.game_id === 'TowersOfHanoi') {
      if (!state) return;
      const source = state.towers[action.from];
      const target = state.towers[action.to];
      const disk = source?.at(-1);
      const targetDisk = target?.at(-1);
      if (!source?.length || disk === undefined || (targetDisk !== undefined && targetDisk < disk)) {
        setError('Movement rule: choose a smaller disk, or move onto an empty peg.');
        return;
      }
    }
    void run({ revision: selected.revision, command: 'act', action: actionFor(selected, action) });
  };

  const openSession = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const session = await loadGameSession(id);
      if (session.snapshot.config.game_id !== game.id) throw new Error('This save belongs to another game.');
      setSelected(session);
      setSelectedIndex(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore that session.');
    } finally {
      setBusy(false);
    }
  };

  const deleteSession = async (id: string) => {
    if (busy) return;
    if (
      !window.confirm(
        'Delete this saved game session? This removes its replay history. Any reward already recorded remains in your token ledger.',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await deleteGameSession(id);
      setList((previous) => {
        if (!previous) return previous;
        const removed = previous.sessions.find((session) => session.id === id);
        return {
          ...previous,
          sessions: previous.sessions.filter((session) => session.id !== id),
          progression:
            removed?.status === 'won'
              ? {
                  ...previous.progression,
                  [removed.snapshot.config.game_id]: Math.max(
                    0,
                    previous.progression[removed.snapshot.config.game_id] - 1,
                  ),
                }
              : previous.progression,
        };
      });
      setSelected((previous) => (previous?.id === id ? null : previous));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete that saved session.');
    } finally {
      setBusy(false);
    }
  };

  const fullscreen = async () => {
    try {
      if (!document.fullscreenElement) await player.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      setError('Full screen is unavailable. You can continue playing in this view.');
    }
  };

  const renderBoard = () => {
    if (!selected || !state) return null;
    if (selected.status === 'ready')
      return (
        <p className="rounded border bg-slate-50 p-4">Ready when you are. Start the session to begin.</p>
      );
    if (selected.status === 'abandoned')
      return (
        <p className="rounded border bg-slate-50 p-4">
          This session was abandoned. Start a new one to play again.
        </p>
      );
    if (selected.snapshot.config.game_id === 'SortingRace') {
      return (
        <div
          className="mx-auto grid w-full max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4"
          role="group"
          aria-label="Sorting board"
        >
          {state.values.map((value, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Position ${index + 1}: ${value}`}
              aria-pressed={selectedIndex === index}
              disabled={selected.status !== 'playing' || busy}
              onClick={() =>
                selectedIndex === null
                  ? setSelectedIndex(index)
                  : selectedIndex === index
                    ? setSelectedIndex(null)
                    : (act({ type: 'swap', left: selectedIndex, right: index }), setSelectedIndex(null))
              }
              className={`group relative grid min-h-24 place-items-center overflow-hidden rounded-2xl border border-amber-950/10 bg-gradient-to-br from-amber-50 to-orange-100 p-3 text-3xl font-black tabular-nums text-amber-950 shadow-[0_8px_20px_-15px_rgba(120,53,15,0.7)] aria-pressed:border-amber-500 aria-pressed:bg-amber-100 aria-pressed:ring-2 aria-pressed:ring-amber-400 disabled:cursor-default sm:min-h-28 sm:text-4xl ${reducedMotion ? '' : 'transition hover:-translate-y-0.5 hover:shadow-lg'}`}
            >
              <span
                aria-hidden="true"
                className="absolute left-3 top-2 text-[10px] font-bold uppercase tracking-widest text-amber-900/45"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>{value}</span>
              <span
                aria-hidden="true"
                className="absolute bottom-2 right-3 font-mono text-xs text-amber-900/40"
              >
                SWAP
              </span>
            </button>
          ))}
        </div>
      );
    }
    if (selected.snapshot.config.game_id === 'NQueens') {
      const size = state.columns.length;
      const queensPlaced = state.columns.filter((column) => column >= 0).length;
      return (
        <div className="mx-auto w-full max-w-[34rem]">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-900/10 bg-white px-4 py-3 shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">Board progress</p>
              <p className="mt-1 text-sm text-slate-600">Place one queen in every row.</p>
            </div>
            <span
              role="status"
              className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold tabular-nums text-emerald-900"
              aria-label={`${queensPlaced} of ${size} queens placed`}
              aria-live="polite"
            >
              {queensPlaced} / {size}
            </span>
          </div>
          <div
            className="overflow-hidden rounded-2xl border border-emerald-950/20 bg-[#183b32] p-2 shadow-[0_18px_45px_-26px_rgba(14,55,43,0.8)] sm:p-3"
            role="group"
            aria-label="N-Queens chessboard"
          >
            <div
              className="grid items-center gap-1 sm:gap-1.5"
              style={{ gridTemplateColumns: `1.25rem repeat(${size}, minmax(0, 1fr))` }}
            >
              <span aria-hidden="true" />
              {Array.from({ length: size }, (_, column) => (
                <span
                  key={column}
                  aria-hidden="true"
                  className="pb-1 text-center text-[10px] font-bold tracking-wide text-emerald-100/75 sm:text-xs"
                >
                  {String.fromCharCode(65 + column)}
                </span>
              ))}
              {state.columns.map((queenColumn, row) => (
                <Fragment key={row}>
                  <span
                    aria-hidden="true"
                    className="pr-1 text-right text-[10px] font-bold tabular-nums text-emerald-100/75 sm:text-xs"
                  >
                    {row + 1}
                  </span>
                  {Array.from({ length: size }, (_, column) => {
                    const occupied = queenColumn === column;
                    const darkSquare = (row + column) % 2 === 1;
                    return (
                      <button
                        key={`${row}-${column}`}
                        type="button"
                        aria-label={`Row ${row + 1}, column ${column + 1}${occupied ? ', queen' : ''}`}
                        aria-pressed={occupied}
                        disabled={selected.status !== 'playing' || busy}
                        onClick={() => act({ type: 'place', row, column })}
                        className={`group grid aspect-square min-w-0 place-items-center overflow-hidden rounded-md border border-white/10 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-300 disabled:cursor-default ${darkSquare ? 'bg-[#39675a] hover:bg-[#477b6b]' : 'bg-[#e8efe4] hover:bg-[#d5e5d8]'} ${occupied ? 'ring-2 ring-inset ring-amber-300/80' : ''} ${reducedMotion ? '' : 'transition duration-150'}`}
                      >
                        {occupied ? (
                          <QueenMark darkSquare={darkSquare} />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="text-sm font-bold text-emerald-950/0 group-hover:text-emerald-950/40"
                          >
                            +
                          </span>
                        )}
                      </button>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
          <p className="mt-3 text-center text-xs font-medium text-slate-500">Place one queen in each row.</p>
        </div>
      );
    }
    if (selected.snapshot.config.game_id === 'TowersOfHanoi') {
      return (
        <div
          className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3"
          role="group"
          aria-label="Towers of Hanoi board"
        >
          {state.towers.map((tower, peg) => (
            <button
              key={peg}
              type="button"
              aria-label={`Peg ${peg + 1}, disks ${tower.join(', ') || 'empty'}`}
              aria-pressed={selectedIndex === peg}
              disabled={selected.status !== 'playing' || busy}
              onClick={() =>
                selectedIndex === null
                  ? setSelectedIndex(peg)
                  : selectedIndex === peg
                    ? setSelectedIndex(null)
                    : (act({ type: 'move', from: selectedIndex, to: peg }), setSelectedIndex(null))
              }
              className={`group relative flex min-h-52 flex-col items-center justify-end overflow-hidden rounded-2xl border border-emerald-950/10 bg-gradient-to-b from-emerald-50 via-white to-emerald-100/80 px-2 pb-3 pt-8 shadow-[0_12px_26px_-20px_rgba(15,75,57,0.75)] aria-pressed:border-emerald-600 aria-pressed:ring-2 aria-pressed:ring-emerald-300 disabled:cursor-default sm:min-h-60 ${reducedMotion ? '' : 'transition hover:-translate-y-0.5'}`}
            >
              <span
                aria-hidden="true"
                className="absolute bottom-12 left-1/2 h-32 w-2 -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-200 to-amber-600 shadow-sm"
              />
              {[...tower].reverse().map((disk) => (
                <span
                  key={disk}
                  className={`relative z-10 mx-auto block h-6 rounded-lg border border-white/50 text-center text-xs font-bold leading-6 text-slate-950 shadow-sm ${reducedMotion ? '' : 'transition-[width,transform] group-hover:brightness-105'}`}
                  style={{
                    background: DISK_COLORS[(disk - 1) % DISK_COLORS.length],
                    width: `${25 + disk * 13}%`,
                  }}
                >
                  {disk}
                </span>
              ))}
              <span
                aria-hidden="true"
                className="absolute inset-x-4 bottom-10 h-2 rounded-full bg-amber-800/70 shadow-sm"
              />
              <span className="relative z-10 mt-3 rounded-full bg-white/80 px-3 py-1 text-xs font-bold uppercase tracking-widest text-emerald-900">
                Peg {peg + 1}
              </span>
            </button>
          ))}
        </div>
      );
    }
    if (!question) return null;
    if (question.activity) {
      return (
        <GameActivity
          key={`${selected.id}:${question.id}`}
          question={question}
          disabled={selected.status !== 'playing' || busy}
          reducedMotion={reducedMotion}
          onAction={act}
        />
      );
    }
    if (!hasPythonObjectives(selected.snapshot.config.game_id)) return null;
    const questionTheme = {
      FlashcardTowerDefense: {
        eyebrow: 'text-orange-900',
        panel: 'border-orange-900/10 bg-gradient-to-br from-orange-50 via-white to-rose-50',
        badge: 'bg-orange-100 text-orange-900 group-hover:bg-orange-700',
        option: 'hover:border-orange-300 hover:bg-orange-50',
        prompt: 'Choose the answer to hold the line.',
      },
      ConceptMatch: {
        eyebrow: 'text-violet-900',
        panel: 'border-violet-900/10 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50',
        badge: 'bg-violet-100 text-violet-900 group-hover:bg-violet-700',
        option: 'hover:border-violet-300 hover:bg-violet-50',
        prompt: 'Find the idea that fits.',
      },
      RetrievalSprint: {
        eyebrow: 'text-cyan-900',
        panel: 'border-cyan-900/10 bg-gradient-to-br from-cyan-50 via-white to-teal-50',
        badge: 'bg-cyan-100 text-cyan-900 group-hover:bg-cyan-700',
        option: 'hover:border-cyan-300 hover:bg-cyan-50',
        prompt: 'Bring the answer back from memory.',
      },
      CodeTrace: {
        eyebrow: 'text-emerald-300',
        panel: 'border-slate-700 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950',
        badge: 'bg-emerald-100 text-emerald-950 group-hover:bg-emerald-400',
        option: 'hover:border-emerald-400 hover:bg-emerald-50',
        prompt: 'Follow each line and predict the output.',
      },
    }[selected.snapshot.config.game_id];
    const codeTraceQuestion = selected.snapshot.config.game_id === 'CodeTrace';
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4" aria-label={`${game.title} question`}>
        <div className={`rounded-2xl border p-5 shadow-sm sm:p-6 ${questionTheme.panel}`}>
          <p className={`text-xs font-bold uppercase tracking-[0.16em] ${questionTheme.eyebrow}`}>
            {questionTheme.prompt}
          </p>
          <pre
            className={`mt-3 whitespace-pre-wrap rounded-xl p-4 text-base font-semibold leading-7 ${codeTraceQuestion ? 'bg-[#0b211b] font-mono text-emerald-100' : 'font-sans text-slate-900'}`}
          >
            {question.prompt}
          </pre>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {question.choices.map((choice, choiceIndex) => (
            <button
              key={choice}
              type="button"
              disabled={selected.status !== 'playing' || busy}
              onClick={() => act({ type: 'answer', question_id: question.id, choice: choiceIndex })}
              className={`group flex min-h-16 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm font-semibold text-slate-800 shadow-sm disabled:cursor-default ${reducedMotion ? questionTheme.option : `transition hover:-translate-y-0.5 ${questionTheme.option} hover:shadow-md`}`}
            >
              <span
                aria-hidden="true"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-black ${questionTheme.badge} ${codeTraceQuestion ? 'text-emerald-950' : ''} ${reducedMotion ? '' : 'transition'} group-hover:text-white`}
              >
                {String.fromCharCode(65 + choiceIndex)}
              </span>
              {choice}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={player}
      className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-slate-950 sm:px-6 sm:py-8 fullscreen:max-w-none fullscreen:overflow-auto"
      aria-busy={busy}
    >
      <a
        href="/games"
        className="inline-flex items-center rounded-full border border-emerald-900/10 bg-white px-4 py-2 text-sm font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50"
      >
        All games
      </a>
      <section className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-[#103f37] via-[#155d4c] to-[#1a765b] p-5 text-white shadow-[0_24px_60px_-34px_rgba(13,71,55,0.8)] sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-20 -z-10 h-64 w-64 rounded-full border border-white/10"
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.17em] text-emerald-100/80">
              {game.category} · {game.duration}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{game.title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-emerald-50/90">{game.objective}</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-emerald-100/75">{game.controls}</p>
            <div className="mt-4 w-fit rounded-xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur-sm [&_p]:!text-white">
              <GameTokenBalance
                reward={selected?.status === 'won' && selected.tokens_awarded > 0 ? selected.id : undefined}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
          >
            Refresh sessions
          </button>
          <button
            type="button"
            onClick={() => void fullscreen()}
            className="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            Full screen
          </button>
        </div>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-emerald-50">
            <input type="checkbox" checked={sound} onChange={(event) => setSound(event.target.checked)} />{' '}
            Sound feedback
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-emerald-50">
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(event) => setReducedMotion(event.target.checked)}
            />{' '}
            Reduce motion
          </label>
        </div>
      </section>
      {error && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{error}</p>
          <button type="button" onClick={() => void refresh()} className="mt-2 underline">
            Try again
          </button>
        </div>
      )}
      {selected && !state && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>This saved session could not be replayed. Reload its server copy to continue.</p>
          <button
            type="button"
            onClick={() =>
              void loadGameSession(selected.id)
                .then(setSelected)
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : 'Could not recover this session.'),
                )
            }
            disabled={busy}
            className="mt-2 underline"
          >
            Reload saved session
          </button>
        </div>
      )}
      <section aria-labelledby="setup-heading">
        <h2 id="setup-heading" className="text-lg font-extrabold tracking-tight text-slate-950">
          Prepare your session
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-600">
            Difficulty
            <select
              value={difficulty}
              onChange={(event) =>
                setDifficulty(
                  GameDifficultySchema.safeParse(event.target.value).success
                    ? (event.target.value as GameDifficulty)
                    : 'easy',
                )
              }
              className="mt-1 block min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case tracking-normal text-slate-900"
            >
              {game.difficulties.map((level) => (
                <option key={level} value={level}>
                  {level[0]?.toUpperCase()}
                  {level.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-10 items-center gap-2 rounded-xl bg-slate-50 px-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={practice}
              onChange={(event) => setPractice(event.target.checked)}
            />{' '}
            Practice mode (hints and undo; no token reward)
          </label>
          {hasPythonObjectives(game.id) && (
            <label className="text-sm">
              Question focus
              <select
                value={objectiveId}
                onChange={(event) => setObjectiveId(event.target.value)}
                className="mt-1 block min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case tracking-normal text-slate-900"
              >
                <option value="">All Python foundations</option>
                {OBJECTIVES.map((objective) => (
                  <option key={objective.id} value={objective.id}>
                    {objective.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="min-h-10 rounded-xl bg-emerald-800 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            New {game.title}
          </button>
        </div>
        {hasPythonObjectives(game.id) && (
          <p className="mt-3 text-sm text-neutral-600">
            Question games use the authored Python foundations set. Game answers do not change scheduled
            flashcard reviews or mastery; scores describe this game session.
          </p>
        )}
        {isQuestionGame(game.id) && !hasPythonObjectives(game.id) && (
          <p className="mt-3 text-sm text-neutral-600">
            Free authored practice. Answers are checked by the server; game scores and adaptive difficulty do
            not certify mastery or change scheduled reviews. Read at your own pace.
          </p>
        )}
      </section>
      {selected && state && (
        <section
          aria-labelledby="active-game-heading"
          className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-emerald-50/60 p-4 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.42)] sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="active-game-heading" className="text-xl font-extrabold tracking-tight text-slate-950">
                Current session
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                {selected.snapshot.config.difficulty} ·{' '}
                {selected.snapshot.config.practice ? 'Practice' : 'Reward eligible'}
              </p>
            </div>
            <span
              role="status"
              className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold capitalize text-emerald-900"
            >
              {selected.status}
            </span>
          </div>
          <div
            className="mt-4 grid grid-cols-3 gap-2 sm:max-w-xl"
            aria-label="Session score"
            aria-live="polite"
          >
            <div className="rounded-xl border border-emerald-900/10 bg-emerald-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-800">Score</p>
              <p className="mt-1 text-xl font-black tabular-nums text-emerald-950">{state.score}</p>
            </div>
            <div className="rounded-xl border border-rose-900/10 bg-rose-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-rose-800">Mistakes</p>
              <p className="mt-1 text-xl font-black tabular-nums text-rose-950">{state.mistakes}</p>
            </div>
            <div className="rounded-xl border border-amber-900/10 bg-amber-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-800">Hints</p>
              <p className="mt-1 text-xl font-black tabular-nums text-amber-950">{state.hints}</p>
            </div>
          </div>
          {selected.snapshot.config.game_id === 'ExamEscape' ? (
            <p className="mt-2 text-sm text-neutral-700">
              Unlock every room with a correct answer to escape. An incorrect answer keeps you in the same
              room; three incorrect answers end the attempt. Read at your own pace; there is no timer.
            </p>
          ) : (
            isQuestionGame(selected.snapshot.config.game_id) && (
              <p className="mt-2 text-sm text-neutral-700">
                Complete the question set with at least 60% correct, rounded up to a whole answer, to win. You
                need at least one correct answer. Three incorrect answers end the session early. Read at your
                own pace; there is no timer.
              </p>
            )
          )}
          <div className="mt-4">{renderBoard()}</div>
          {state.feedback && (
            <div role="status" className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
              <p className="font-medium">{state.feedback.correct ? 'Correct' : 'Keep learning'}</p>
              <p>{state.feedback.explanation}</p>
              <a className="underline" href={state.feedback.source.url} target="_blank" rel="noreferrer">
                Read source: {state.feedback.source.label}
              </a>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {selected.status === 'ready' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run({ revision: selected.revision, command: 'start' })}
                className="min-h-11 rounded-xl bg-emerald-800 px-5 py-2 font-bold text-white shadow-sm transition hover:bg-emerald-900 disabled:opacity-50"
              >
                Start
              </button>
            )}
            {selected.status === 'playing' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run({ revision: selected.revision, command: 'pause' })}
                className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 py-2 font-bold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Pause
              </button>
            )}
            {selected.status === 'paused' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run({ revision: selected.revision, command: 'resume' })}
                className="min-h-11 rounded-xl bg-emerald-800 px-5 py-2 font-bold text-white shadow-sm transition hover:bg-emerald-900 disabled:opacity-50"
              >
                Resume
              </button>
            )}
            {(selected.status === 'ready' ||
              selected.status === 'playing' ||
              selected.status === 'paused') && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run({ revision: selected.revision, command: 'abandon' })}
                className="min-h-11 rounded-xl border border-rose-200 bg-white px-5 py-2 font-bold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
              >
                Abandon
              </button>
            )}
            {(selected.status === 'won' || selected.status === 'lost') && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void retryAsNewSession()}
                className="rounded border px-4 py-2"
              >
                Retry as new session
              </button>
            )}
            {selected.status === 'won' && (
              <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {selected.tokens_awarded > 0
                  ? `${selected.tokens_awarded} token(s) awarded by the server.`
                  : 'No reward was recorded for this session.'}
              </p>
            )}
          </div>
          {!state.feedback && <p className="mt-3 text-sm text-neutral-700">{state.explanation}</p>}
          {state.hints > 0 && (
            <p className="mt-2 rounded bg-amber-50 p-2 text-sm" role="status">
              Hint:{' '}
              {isQuestionGame(selected.snapshot.config.game_id)
                ? 'Reread the concept in the prompt and eliminate choices that do not answer it.'
                : 'Compare the current arrangement with the goal and make one legal move toward it.'}
            </p>
          )}
          {selected.snapshot.config.practice && selected.status === 'playing' && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy || selected.snapshot.actions.length === 0}
                onClick={() => act({ type: 'undo' })}
                className="rounded border px-3 py-2"
              >
                Undo
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => act({ type: 'hint' })}
                className="rounded border px-3 py-2"
              >
                Hint
              </button>
            </div>
          )}
        </section>
      )}
      <section aria-labelledby="resume-heading">
        <h2 id="resume-heading" className="text-lg font-semibold">
          Saved sessions
        </h2>
        {!list ? (
          <p role="status" className="mt-2">
            Loading sessions…
          </p>
        ) : savedGames.length === 0 ? (
          <p className="mt-2 rounded border p-4">No saved sessions for {game.title} yet.</p>
        ) : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {savedGames.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
              >
                <div>
                  <p className="text-xs text-neutral-500">
                    {session.snapshot.config.difficulty} ·{' '}
                    {session.snapshot.config.practice ? 'practice' : 'reward eligible'} · {session.status}
                    {session.snapshot.config.objective_id
                      ? ` · ${OBJECTIVES.find((objective) => objective.id === session.snapshot.config.objective_id)?.label ?? session.snapshot.config.objective_id}`
                      : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openSession(session.id)}
                    className="rounded border px-3 py-2 text-sm"
                  >
                    {session.status === 'won' || session.status === 'lost' || session.status === 'abandoned'
                      ? 'View'
                      : 'Resume'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteSession(session.id)}
                    className="rounded border border-red-300 px-3 py-2 text-sm text-red-700"
                  >
                    Delete saved game
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
