'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { GameVaultEntry } from '@/lib/game-vault/catalog';
import { completeDemo, loadDemo, saveDemo, unlockDemo, type DemoStorage } from '@/lib/game-vault/demo-store';
import {
  hostMessage,
  isRecord,
  readGameMessage,
  readVaultState,
  type GameMessage,
  type HostMessageType,
  type VaultState,
} from '@/lib/game-vault/protocol';

type CachedResponse = { signature: string; type: HostMessageType; payload: Record<string, unknown> };
class VaultApiError extends Error {
  constructor(
    readonly code: string,
    readonly offline: boolean,
  ) {
    super(code);
  }
}

function storage(): DemoStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function api(path: string, body?: Record<string, unknown>): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2200);
  try {
    const response = await fetch(`/api/game-vault/${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(data) || data.ok !== true) {
      const code = isRecord(data) && typeof data.error === 'string' ? data.error : `http_${response.status}`;
      throw new VaultApiError(code, response.status >= 500);
    }
    return data.state;
  } catch (error) {
    if (error instanceof VaultApiError) throw error;
    throw new VaultApiError('backend_unavailable', true);
  } finally {
    window.clearTimeout(timer);
  }
}

export function GameVaultPlayer({ game, localDemo = false }: { game: GameVaultEntry; localDemo?: boolean }) {
  return localDemo ? (
    <VaultPlayer game={game} localDemo isLoaded userId="local-offline-student" displayName="Local Explorer" />
  ) : (
    <AuthenticatedVaultPlayer game={game} />
  );
}

function AuthenticatedVaultPlayer({ game }: { game: GameVaultEntry }) {
  const { user, isLoaded } = useUser();
  return (
    <VaultPlayer
      game={game}
      isLoaded={isLoaded}
      userId={user?.id}
      displayName={user?.firstName || user?.username || 'Student Explorer'}
    />
  );
}

function VaultPlayer({
  game,
  localDemo = false,
  isLoaded,
  userId,
  displayName,
}: {
  game: GameVaultEntry;
  localDemo?: boolean;
  isLoaded: boolean;
  userId?: string;
  displayName: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const current = useRef<VaultState | null>(null);
  const busy = useRef(false);
  const ready = useRef(false);
  const responses = useRef(new Map<string, CachedResponse>());
  const pending = useRef<{ id: string; signature: string } | null>(null);
  const [state, setState] = useState<VaultState | null>(null);
  const [notice, setNotice] = useState('Connecting to your EduSphere account…');
  const [reload, setReload] = useState(0);
  const [canLoad, setCanLoad] = useState(game.bridge === 'none');
  const [fullError, setFullError] = useState('');

  useEffect(() => {
    if (game.bridge !== 'edusphere-v1' || !isLoaded || !userId) return;
    let active = true;
    ready.current = false;
    current.current = null;
    busy.current = false;
    responses.current.clear();
    pending.current = null;
    setCanLoad(false);
    setState(null);

    const publish = (next: VaultState) => {
      current.current = next;
      if (active) setState(next);
    };
    const send = (type: HostMessageType, requestId: string, payload: Record<string, unknown>) => {
      frame.current?.contentWindow?.postMessage(
        hostMessage(game.id, type, requestId, payload),
        window.location.origin,
      );
    };
    const init = () => {
      if (current.current) send('EDUSPHERE_INIT_CONTEXT', '', { ...current.current });
    };
    const fallback = () => {
      const demo = loadDemo(storage(), { id: userId, displayName }, game.id);
      publish(demo);
      setNotice(
        'Backend unavailable. You are using separate local demo tokens; your real balance and unlocks are untouched.',
      );
      return demo;
    };
    const remember = (
      message: GameMessage,
      type: HostMessageType,
      payload: Record<string, unknown>,
      signature: string,
    ) => {
      responses.current.set(message.requestId, { signature, type, payload });
      if (responses.current.size > 100)
        responses.current.delete(responses.current.keys().next().value as string);
      send(type, message.requestId, payload);
    };

    const act = async (message: GameMessage) => {
      const missionId = String(message.payload.missionId);
      const isUnlock = message.type === 'EDUSPHERE_UNLOCK_MISSION_REQUEST';
      const responseType: HostMessageType = isUnlock
        ? 'EDUSPHERE_UNLOCK_MISSION_RESPONSE'
        : 'EDUSPHERE_MISSION_PROGRESS_RESPONSE';
      const signature = JSON.stringify([message.type, message.payload]);
      const previous = responses.current.get(message.requestId);
      if (previous) {
        send(
          responseType,
          message.requestId,
          previous.signature === signature
            ? previous.payload
            : { missionId, ok: false, error: 'request_id_reused' },
        );
        return;
      }
      if (busy.current) {
        // An identical in-flight delivery waits for the original response.
        if (pending.current?.id === message.requestId && pending.current.signature === signature) return;
        send(responseType, message.requestId, { missionId, ok: false, error: 'operation_pending' });
        return;
      }
      const snapshot = current.current;
      if (!snapshot) return;
      busy.current = true;
      pending.current = { id: message.requestId, signature };
      try {
        if (snapshot.mode === 'demo') {
          const result = isUnlock
            ? unlockDemo(snapshot, game.id, missionId)
            : completeDemo(snapshot, game.id, missionId, message.payload.evidence);
          if (result.ok) {
            publish(result.state);
            if (!saveDemo(storage(), game.id, result.state))
              setNotice(
                'Local demo is active. Browser storage is unavailable; progress lasts for this session only.',
              );
            remember(message, responseType, { missionId, ok: true, state: result.state }, signature);
          } else remember(message, responseType, { missionId, ok: false, error: result.error }, signature);
        } else {
          const raw = await api(isUnlock ? 'unlock' : 'progress', {
            gameId: game.id,
            missionId,
            requestId: message.requestId,
            ...(isUnlock ? {} : { evidence: message.payload.evidence }),
          });
          if (!active) return;
          const next = readVaultState(raw, game);
          if (!next || next.mode !== 'production') throw new VaultApiError('invalid_backend_state', false);
          publish(next);
          remember(message, responseType, { missionId, ok: true, state: next }, signature);
        }
      } catch (error) {
        if (!active) return;
        const reason = error instanceof VaultApiError ? error : new VaultApiError('operation_failed', false);
        // A timeout may have committed server-side. Never replay it in the demo.
        remember(
          message,
          responseType,
          { missionId, ok: false, error: reason.offline ? 'backend_unavailable_retry_in_demo' : reason.code },
          signature,
        );
        if (reason.offline) {
          fallback();
          init();
        } else if (reason.code.includes('401') || reason.code === 'unauthorized') {
          setNotice('Your session needs attention. Sign in again to use your EduSphere tokens.');
        } else setNotice(`Request was not accepted: ${reason.code.replaceAll('_', ' ')}.`);
      } finally {
        busy.current = false;
        pending.current = null;
      }
    };

    const receive = (event: MessageEvent) => {
      if (!active) return;
      const message = readGameMessage(
        event,
        frame.current?.contentWindow ?? null,
        window.location.origin,
        game,
      );
      if (!message) return;
      if (message.type === 'EDUSPHERE_GAME_READY') {
        ready.current = true;
        init();
      } else void act(message);
    };
    window.addEventListener('message', receive);
    void (async () => {
      if (localDemo) {
        fallback();
        setNotice(
          'Local offline demo: 100 starting synthetic tokens. Unlocks, XP and achievements are saved only in this browser.',
        );
        setCanLoad(true);
        return;
      }
      try {
        const raw = await api(`context?gameId=${encodeURIComponent(game.id)}`);
        if (!active) return;
        const next = readVaultState(raw, game);
        if (!next || next.mode !== 'production') throw new VaultApiError('invalid_backend_state', false);
        publish(next);
        setNotice('Connected to EduSphere. Mission unlocks are permanent; replays are free.');
      } catch (error) {
        if (!active) return;
        const reason =
          error instanceof VaultApiError ? error : new VaultApiError('backend_unavailable', true);
        if (reason.offline) fallback();
        else {
          setNotice(
            `Could not load your account: ${reason.code.replaceAll('_', ' ')}. Sign in again or retry the connection.`,
          );
          return;
        }
      }
      if (active) {
        setCanLoad(true);
        if (ready.current) init();
      }
    })();
    return () => {
      active = false;
      window.removeEventListener('message', receive);
    };
  }, [game, isLoaded, userId, displayName, reload, localDemo]);

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.current?.requestFullscreen();
      setFullError('');
    } catch {
      setFullError('Fullscreen is unavailable here. You can resize the browser window instead.');
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Game Vault / {game.category}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">{game.title}</h1>
        </div>
        <div className="flex flex-wrap gap-3 text-sm" aria-live="polite">
          {state ? (
            <>
              <span className="rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-900">
                ◈ {state.tokens} {state.mode === 'demo' ? 'demo tokens' : 'focus tokens'}
              </span>
              <span className="rounded-lg bg-emerald-50 px-3 py-2 font-semibold text-emerald-900">
                {state.xp} XP · {state.achievements.length} achievement
                {state.achievements.length === 1 ? '' : 's'}
              </span>
            </>
          ) : (
            <span className="text-slate-500">
              {game.bridge === 'none' ? 'Original server-verified game rewards' : 'Loading account…'}
            </span>
          )}
          <Link
            href="/games"
            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-50"
          >
            All games
          </Link>
        </div>
      </div>
      {game.bridge !== 'none' && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${state?.mode === 'demo' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-950'}`}
        >
          <p role="status">{notice}</p>
          <button
            type="button"
            onClick={() => {
              if (!busy.current) setReload((value) => value + 1);
            }}
            className="rounded border border-current px-3 py-1 font-medium"
          >
            {localDemo ? 'Reload local demo' : 'Retry backend'}
          </button>
        </div>
      )}
      <div
        ref={shell}
        className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-100"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <p className="text-xs sm:text-sm">{game.controls}</p>
          <button
            type="button"
            onClick={() => void fullscreen()}
            className="rounded-md border border-slate-500 px-3 py-1.5 text-sm hover:border-emerald-300 hover:text-emerald-200"
          >
            Fullscreen
          </button>
        </div>
        {canLoad ? (
          <iframe
            key={`${game.id}:${reload}`}
            ref={frame}
            title={`${game.title} interactive player`}
            src={game.entryUrl}
            allow="fullscreen; autoplay"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-pointer-lock"
            className="block h-[min(72vh,850px)] min-h-[480px] w-full border-0 bg-slate-950 fullscreen:h-[calc(100vh-64px)]"
          />
        ) : (
          <div className="flex min-h-[480px] items-center justify-center p-8 text-center text-slate-300">
            {!isLoaded
              ? 'Loading your student session…'
              : !userId
                ? 'Sign in with your existing EduSphere account to play.'
                : notice}
          </div>
        )}
      </div>
      {fullError && (
        <p className="text-sm text-amber-800" role="status">
          {fullError}
        </p>
      )}
      <p className="text-sm text-slate-600">
        {game.id === 'cyberverse'
          ? 'Desktop (Keyboard + Mouse): click inside the game to focus; P pauses and releases the mouse. Mobile/Tablet (Touch Controls): use the left stick to move, drag on the right to look, and tap the action buttons. The Pause menu includes a Touch HUD toggle. Browsers may reserve Escape for exiting pointer lock or fullscreen.'
          : 'The Logic Arcade supports mouse, touch and keyboard controls. Click or tap inside the game to focus its controls.'}
      </p>
    </section>
  );
}
