'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';
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

function isQuestionGame(id: GameId): boolean {
  return (
    id === 'FlashcardTowerDefense' || id === 'ConceptMatch' || id === 'RetrievalSprint' || id === 'CodeTrace'
  );
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
        ...(isQuestionGame(game.id) && objectiveId
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Sorting board">
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
              className="min-h-20 rounded border bg-white p-3 text-2xl font-semibold shadow-sm aria-pressed:border-blue-600 aria-pressed:bg-blue-50"
            >
              {value}
            </button>
          ))}
        </div>
      );
    }
    if (selected.snapshot.config.game_id === 'NQueens') {
      return (
        <div
          className="grid max-w-lg gap-1"
          style={{ gridTemplateColumns: `repeat(${state.columns.length}, minmax(0, 1fr))` }}
          aria-label="N-Queens board"
        >
          {state.columns.map((queenColumn, row) =>
            Array.from({ length: state.columns.length }, (_, column) => (
              <button
                key={`${row}-${column}`}
                type="button"
                aria-label={`Row ${row + 1}, column ${column + 1}${queenColumn === column ? ', queen' : ''}`}
                aria-pressed={queenColumn === column}
                disabled={selected.status !== 'playing' || busy}
                onClick={() => act({ type: 'place', row, column })}
                className="aspect-square rounded border bg-slate-50 text-2xl aria-pressed:bg-amber-100"
              >
                {queenColumn === column ? '♛' : ''}
              </button>
            )),
          )}
        </div>
      );
    }
    if (selected.snapshot.config.game_id === 'TowersOfHanoi') {
      return (
        <div className="grid grid-cols-3 gap-2" aria-label="Towers of Hanoi board">
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
              className="flex min-h-48 flex-col justify-end gap-1 rounded border bg-slate-50 p-2 aria-pressed:border-blue-600"
            >
              {[...tower].reverse().map((disk) => (
                <span
                  key={disk}
                  className="mx-auto block h-6 rounded bg-blue-500 text-center text-xs text-white"
                  style={{ width: `${25 + disk * 13}%` }}
                >
                  {disk}
                </span>
              ))}
              <span className="mt-2 text-sm">Peg {peg + 1}</span>
            </button>
          ))}
        </div>
      );
    }
    if (!isQuestionGame(selected.snapshot.config.game_id) || !question) return null;
    return (
      <div className="space-y-3" aria-label={`${game.title} question`}>
        <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{question.prompt}</pre>
        <div className="grid gap-2 sm:grid-cols-2">
          {question.choices.map((choice, choiceIndex) => (
            <button
              key={choice}
              type="button"
              disabled={selected.status !== 'playing' || busy}
              onClick={() => act({ type: 'answer', question_id: question.id, choice: choiceIndex })}
              className="rounded border bg-white p-3 text-left hover:bg-blue-50"
            >
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
      className="mx-auto max-w-4xl space-y-5 bg-white px-4 py-6 text-slate-950 sm:px-6 fullscreen:max-w-none fullscreen:overflow-auto"
      aria-busy={busy}
    >
      <a
        href="/games"
        className="inline-block text-sm font-semibold text-blue-800 underline hover:text-blue-950"
      >
        All games
      </a>
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-800">
              {game.category} · {game.duration}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{game.title}</h1>
            <p className="mt-2 text-sm text-slate-700">{game.objective}</p>
            <p className="mt-1 text-sm text-slate-700">{game.controls}</p>
            <div className="mt-3">
              <GameTokenBalance
                reward={selected?.status === 'won' && selected.tokens_awarded > 0 ? selected.id : undefined}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded border px-3 py-2 text-sm"
          >
            Refresh sessions
          </button>
          <button
            type="button"
            onClick={() => void fullscreen()}
            className="rounded border px-3 py-2 text-sm"
          >
            Full screen
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sound} onChange={(event) => setSound(event.target.checked)} />{' '}
            Sound feedback
          </label>
          <label className="flex items-center gap-2">
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
        <h2 id="setup-heading" className="text-lg font-semibold">
          Set up a session
        </h2>
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded bg-slate-50 p-3">
          <label className="text-sm">
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
              className="ml-2 rounded border p-2"
            >
              {game.difficulties.map((level) => (
                <option key={level} value={level}>
                  {level[0]?.toUpperCase()}
                  {level.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={practice}
              onChange={(event) => setPractice(event.target.checked)}
            />{' '}
            Practice mode (hints and undo; no token reward)
          </label>
          {isQuestionGame(game.id) && (
            <label className="text-sm">
              Question focus
              <select
                value={objectiveId}
                onChange={(event) => setObjectiveId(event.target.value)}
                className="ml-2 rounded border p-2"
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
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
          >
            New {game.title}
          </button>
        </div>
        {isQuestionGame(game.id) && (
          <p className="mt-3 text-sm text-neutral-600">
            Question games use the authored Python foundations set. Game answers do not change scheduled
            flashcard reviews or mastery; scores describe this game session.
          </p>
        )}
      </section>
      {selected && state && (
        <section aria-labelledby="active-game-heading" className="rounded border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="active-game-heading" className="text-xl font-semibold">
                Current session
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                {selected.snapshot.config.difficulty} ·{' '}
                {selected.snapshot.config.practice ? 'Practice' : 'Reward eligible'}
              </p>
            </div>
            <span role="status" className="rounded bg-slate-100 px-2 py-1 text-sm">
              {selected.status}
            </span>
          </div>
          <p className="mt-3 text-sm" aria-live="polite">
            Score {state.score} · Mistakes {state.mistakes} · Hints {state.hints}
          </p>
          {isQuestionGame(selected.snapshot.config.game_id) && (
            <p className="mt-2 text-sm text-neutral-700">
              Complete the question set with at least 60% correct, rounded up to a whole answer, to win. You
              need at least one correct answer. Three incorrect answers end the session early. Read at your
              own pace; there is no timer.
            </p>
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
          <div className="mt-4 flex flex-wrap gap-2">
            {selected.status === 'ready' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run({ revision: selected.revision, command: 'start' })}
                className="rounded bg-blue-600 px-4 py-2 text-white"
              >
                Start
              </button>
            )}
            {selected.status === 'playing' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run({ revision: selected.revision, command: 'pause' })}
                className="rounded border px-4 py-2"
              >
                Pause
              </button>
            )}
            {selected.status === 'paused' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run({ revision: selected.revision, command: 'resume' })}
                className="rounded bg-blue-600 px-4 py-2 text-white"
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
                className="rounded border border-red-300 px-4 py-2 text-red-700"
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
