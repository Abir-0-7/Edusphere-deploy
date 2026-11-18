'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect, useRef, useState } from 'react';
import { CYBERVERSE_BINARY_CITY_COST, CYBERVERSE_GAME_ID, type CyberverseState } from '@studyvault/types';
import {
  CyberverseApiError,
  cyberverseHostMessage,
  cyberverseRequest,
  readCyberverseMessage,
} from '@/lib/cyberverse-client';

const gameAsset = '/games/cyberverse/index.html';
const fallbackMessage =
  'Cyberverse could not connect. Retry to refresh your StudyVault balance and progress.';

export function CyberversePlayer() {
  const { userId, isLoaded } = useAuth();
  if (!isLoaded) return <p role="status">Loading your session…</p>;
  return userId ? <AccountCyberverse key={userId} /> : <p>Sign in to play Cyberverse.</p>;
}

function AccountCyberverse() {
  const frame = useRef<HTMLIFrameElement>(null);
  const account = useRef<CyberverseState | null>(null);
  const loaded = useRef(false);
  const [state, setState] = useState<CyberverseState | null>(null);
  const [notice, setNotice] = useState('Connecting to StudyVault…');
  const [booted, setBooted] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    let busy = false;
    let pendingId = '';
    let bootTimeout: number | undefined;
    const send = (target: Window, type: string, requestId: string, payload: object) => {
      target.postMessage(cyberverseHostMessage(type, requestId, payload), window.location.origin);
    };
    const publish = (next: CyberverseState) => {
      account.current = next;
      setState(next);
    };

    const receive = async (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || !active || !account.current) return;
      const message = readCyberverseMessage(event, target, window.location.origin);
      if (!message) return;
      if (message.type === 'EDUSPHERE_GAME_READY') {
        window.clearTimeout(bootTimeout);
        setBooted(true);
        loaded.current = true;
        send(target, 'EDUSPHERE_INIT_CONTEXT', '', account.current);
        return;
      }
      const unlock = message.type === 'EDUSPHERE_UNLOCK_MISSION_REQUEST';
      const reply = unlock ? 'EDUSPHERE_UNLOCK_MISSION_RESPONSE' : 'EDUSPHERE_MISSION_PROGRESS_RESPONSE';
      const { requestId, payload } = message;
      if (busy) {
        if (requestId !== pendingId)
          send(target, reply, requestId, {
            missionId: payload.missionId,
            ok: false,
            error: 'operation_pending',
          });
        return;
      }
      busy = true;
      pendingId = requestId;
      try {
        const next = await cyberverseRequest(unlock ? 'unlock' : 'progress', {
          gameId: CYBERVERSE_GAME_ID,
          requestId,
          ...payload,
          completed: undefined,
        });
        if (!active || target !== frame.current?.contentWindow) return;
        publish(next);
        setNotice(unlock ? 'Binary City unlocked. Replays are free.' : 'Mission progress saved.');
        send(target, reply, requestId, { missionId: payload.missionId, ok: true, state: next });
      } catch (error) {
        if (!active || target !== frame.current?.contentWindow) return;
        setNotice(error instanceof CyberverseApiError ? error.message : fallbackMessage);
        send(target, reply, requestId, {
          missionId: payload.missionId,
          ok: false,
          error: error instanceof CyberverseApiError ? error.code : 'service_unavailable',
        });
      } finally {
        busy = false;
        pendingId = '';
      }
    };

    window.addEventListener('message', receive);
    void cyberverseRequest('context')
      .then((next) => {
        if (!active) return;
        publish(next);
        setNotice('Loading the game…');
        bootTimeout = window.setTimeout(() => {
          if (active) setNotice('The game is taking longer to load. You can retry the connection.');
        }, 45_000);
      })
      .catch((error: unknown) => {
        if (active) setNotice(error instanceof CyberverseApiError ? error.message : fallbackMessage);
      });
    return () => {
      active = false;
      window.clearTimeout(bootTimeout);
      window.removeEventListener('message', receive);
    };
  }, [reload]);

  function retry() {
    account.current = null;
    loaded.current = false;
    setState(null);
    setBooted(false);
    setNotice('Connecting to StudyVault…');
    setReload((value) => value + 1);
  }

  return (
    <section className="space-y-4" aria-label="Cyberverse player">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" aria-live="polite">
        <p>
          Study tokens: <strong>{state?.tokens ?? 'Unavailable'}</strong>
        </p>
        <p>
          Game XP: <strong>{state?.xp ?? 'Unavailable'}</strong>
        </p>
        <p>
          {state?.unlocked.includes('binary_city')
            ? 'Binary City is unlocked'
            : `Binary City costs ${CYBERVERSE_BINARY_CITY_COST} study tokens to unlock`}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status">{booted && notice === 'Loading the game…' ? 'Cyberverse is ready.' : notice}</p>
        <button type="button" className="rounded border px-3 py-2 text-sm" onClick={retry}>
          Retry connection
        </button>
      </div>
      {state && (
        <iframe
          ref={frame}
          key={reload}
          src={gameAsset}
          title="Cyberverse interactive game"
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
          allow="fullscreen; autoplay"
          allowFullScreen
          className="block h-[min(72vh,850px)] min-h-[380px] w-full rounded-xl border bg-black"
        />
      )}
    </section>
  );
}
