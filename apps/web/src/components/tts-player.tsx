'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * TTS player with karaoke highlighting and SpeechSynthesis fallback (tasks
 * 4.1-4.3). The server path returns audio plus word boundaries; when it is
 * unavailable we fall back to the browser's own speech, which has no timing
 * data, so the karaoke cue falls back to a whole-text highlight instead of a
 * per-word one.
 */

interface WordTiming {
  text: string;
  start_ms: number;
  end_ms: number;
}

interface Props {
  documentId: string;
  getText: () => string;
}

async function consumeSse(
  response: Response,
  onAudio: (chunk: Uint8Array) => void,
  onWord: (word: WordTiming) => void,
  onDone: () => void,
): Promise<void> {
  if (!response.body) throw new Error('audio stream unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parseBlock = (block: string) => {
    const event = block.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
    const data = block.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim() ?? '';
    if (event === 'audio') onAudio(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)));
    else if (event === 'word') onWord(JSON.parse(data) as WordTiming);
    else if (event === 'error') throw new Error('speech synthesis failed');
    else if (event === 'done') onDone();
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      parseBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
  if (buffer.trim()) parseBlock(buffer);
}

const baseUrl = () => process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';

function useSpeech() {
  return useCallback((text: string, onEnd: () => void) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return null;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = onEnd;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return () => window.speechSynthesis.cancel();
  }, []);
}

export function TtsPlayer({ documentId, getText }: Props) {
  const { getToken } = useAuth();
  const [words, setWords] = useState<WordTiming[]>([]);
  const [fallback, setFallback] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wordsRef = useRef<WordTiming[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopFallback = useRef<(() => void) | null>(null);
  const speak = useSpeech();

  const stop = useCallback(() => {
    stopFallback.current?.();
    audioRef.current?.pause();
    setPlaying(false);
    setActiveIndex(-1);
    wordsRef.current = [];
    setWords([]);
  }, []);

  const play = useCallback(async () => {
    stop();
    setErr(null);
    setBusy(true);
    const text = getText().trim();
    if (!text) {
      setErr('Nothing to read out yet.');
      setBusy(false);
      return;
    }

    // Server-side TTS (edge-tts). 503 means "use the browser voice".
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl()}/api/tts/stream`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text, document_id: documentId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/mpeg')) throw new Error('streaming audio unsupported');
      const mediaSource = new MediaSource();
      const url = URL.createObjectURL(mediaSource);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      const sourceOpen = new Promise<SourceBuffer>((resolve, reject) => {
        mediaSource.addEventListener('sourceopen', () => resolve(mediaSource.addSourceBuffer('audio/mpeg')), { once: true });
        mediaSource.addEventListener('error', () => reject(new Error('audio source failed')), { once: true });
      });
      const buffer = await sourceOpen;
      const queued: ArrayBuffer[] = [];
      let finished = false;
      let firstChunk: (() => void) | null = null;
      const firstChunkReady = new Promise<void>((resolve) => { firstChunk = resolve; });
      const endWhenFlushed = () => {
        if (finished && queued.length === 0 && !buffer.updating && mediaSource.readyState === 'open') mediaSource.endOfStream();
      };
      buffer.addEventListener('updateend', () => {
        if (firstChunk) { firstChunk(); firstChunk = null; }
        const next = queued.shift();
        if (next) buffer.appendBuffer(next);
        else endWhenFlushed();
      });
      const append = (chunk: Uint8Array) => {
        const bytes = new Uint8Array(chunk.byteLength);
        bytes.set(chunk);
        if (buffer.updating || queued.length) queued.push(bytes.buffer);
        else buffer.appendBuffer(bytes.buffer);
      };
      const streamFinished = consumeSse(res, append, (word) => {
        wordsRef.current = [...wordsRef.current, word];
        setWords(wordsRef.current);
      }, () => { finished = true; endWhenFlushed(); });
      await firstChunkReady;
      audio.ontimeupdate = () => {
        const ms = audio.currentTime * 1000;
        setActiveIndex(wordsRef.current.findIndex((word) => ms >= word.start_ms && ms < word.end_ms));
      };
      await audio.play();
      setPlaying(true);
      setFallback(false);
      await streamFinished;
    } catch {
      // Fallback: the browser's own voice (no word timings -> whole-text highlight).
      const stopSpeech = speak(text, () => setPlaying(false));
      if (!stopSpeech) {
        setErr('No voice available on this device.');
      } else {
        setFallback(true);
        stopFallback.current = stopSpeech;
      }
      setPlaying(Boolean(stopSpeech));
      setBusy(false);
      return;
    }

    setBusy(false);
  }, [documentId, getText, getToken, speak, stop]);

  // Stop speech when the component unmounts.
  useEffect(() => () => stop(), [stop]);

  return (
    <div className="mt-3 rounded border p-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (playing ? stop() : void play())}
          disabled={busy}
          className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-900 disabled:opacity-50"
        >
          {busy ? 'Preparing…' : playing ? 'Stop' : 'Listen'}
        </button>
        {fallback && <span className="text-xs text-neutral-500">browser voice</span>}
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {words.length > 0 && !fallback && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
          {words.map((w, i) => (
            <span key={i} className={i === activeIndex ? 'rounded bg-yellow-200 px-0.5' : undefined}>
              {w.text}{' '}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
