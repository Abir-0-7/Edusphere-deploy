'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioBase64Schema,
  TtsRequestSchema,
  TtsDoneEventSchema,
  TtsErrorEventSchema,
  WordTimingSchema,
  type WordTiming,
} from '@studyvault/types';
import { authFetch } from '@/lib/ai-client';
import { readEventStream } from '@/lib/event-stream';

const ONLINE_VOICES = [
  { id: 'en-US-AriaNeural', name: 'Aria · English (US)', lang: 'en-US' },
  { id: 'en-US-JennyNeural', name: 'Jenny · English (US)', lang: 'en-US' },
  { id: 'en-US-GuyNeural', name: 'Guy · English (US)', lang: 'en-US' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia · English (UK)', lang: 'en-GB' },
  { id: 'en-GB-RyanNeural', name: 'Ryan · English (UK)', lang: 'en-GB' },
  { id: 'en-AU-NatashaNeural', name: 'Natasha · English (Australia)', lang: 'en-AU' },
  { id: 'bn-BD-NabanitaNeural', name: 'Nabanita · Bangla (Bangladesh)', lang: 'bn-BD' },
  { id: 'bn-BD-PradeepNeural', name: 'Pradeep · Bangla (Bangladesh)', lang: 'bn-BD' },
] as const;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const HOSTED_TEXT_LIMIT = 5000;
const START_TIMEOUT_MS = 6000;
type Phase = 'idle' | 'preparing' | 'online' | 'browser';

interface Props {
  sourceKey: string;
  getText: () => string;
  label: string;
  disabled?: boolean;
}
// Chapter and answer narration share the audio output.
let stopCurrentPlayer: (() => void) | undefined;

export function speechChunks(text: string): string[] {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  const chunks: string[] = [];
  for (let start = 0; start < characters.length;) {
    const end = Math.min(start + 220, characters.length);
    const part = characters.slice(start, end);
    const separator = end === characters.length ? -1 : part.lastIndexOf(' ');
    const length = separator > 0 ? separator + 1 : part.length;
    chunks.push(part.slice(0, length).join('').trim());
    start += length;
  }
  return chunks;
}
function speakOnDevice(
  text: string,
  rate: number,
  voice: SpeechSynthesisVoice | undefined,
  lang: string | undefined,
  finish: (failed: boolean) => void,
): (() => void) | undefined {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  const chunks = speechChunks(text);
  let index = 0;
  let utterance: SpeechSynthesisUtterance | null = null;
  function next() {
    const chunk = chunks[index++];
    if (!chunk) {
      utterance = null;
      finish(false);
      return;
    }
    utterance = new SpeechSynthesisUtterance(chunk);
    if (voice) utterance.voice = voice;
    if (lang) utterance.lang = lang;
    utterance.rate = rate;
    utterance.onend = next;
    utterance.onerror = () => {
      utterance = null;
      finish(true);
    };
    synth.speak(utterance);
  }
  next();
  return () => {
    if (!utterance) return;
    utterance.onend = null;
    utterance.onerror = null;
    utterance = null;
    synth.cancel();
  };
}

export async function consumeSpeechStream(
  response: Response,
  onAudio: (audio: Uint8Array) => void,
  onWord: (word: WordTiming) => void,
) {
  let hasAudio = false;
  for await (const frame of readEventStream(response)) {
    if (frame.event === 'audio') {
      const bytes = Uint8Array.from(atob(AudioBase64Schema.parse(frame.data)), (char) => char.charCodeAt(0));
      if (bytes.length) {
        onAudio(bytes);
        hasAudio = true;
      }
    } else if (frame.event === 'word') {
      const word = WordTimingSchema.parse(JSON.parse(frame.data));
      onWord(word);
    } else if (frame.event === 'done' && hasAudio) {
      TtsDoneEventSchema.parse(JSON.parse(frame.data));
      return;
    } else if (frame.event === 'error') {
      TtsErrorEventSchema.parse(JSON.parse(frame.data));
      throw new Error('Speech synthesis failed');
    } else {
      throw new Error('Speech synthesis failed');
    }
  }
  throw new Error('Speech stream ended before completion');
}

export function TtsPlayer({ sourceKey, getText, label, disabled }: Props) {
  const { getToken } = useAuth();
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[] | null>(null);
  const [voiceId, setVoiceId] = useState<string>(ONLINE_VOICES[0].id);
  const [speed, setSpeed] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [words, setWords] = useState<WordTiming[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeRequest = useRef<AbortController | null>(null);
  const clearOnline = useRef<(() => void) | undefined>(undefined);
  const clearDevice = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    const update = () => setDeviceVoices(synth.getVoices());
    update();
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, []);

  const stop = useCallback(() => {
    if (stopCurrentPlayer === stop) stopCurrentPlayer = undefined;
    const controller = activeRequest.current;
    activeRequest.current = null;
    controller?.abort();
    clearOnline.current?.();
    clearOnline.current = undefined;
    clearDevice.current?.();
    clearDevice.current = undefined;
    setPhase('idle');
    setNotice('');
    setWords([]);
    setActiveIndex(-1);
  }, []);

  useEffect(() => {
    setError('');
    return stop;
  }, [sourceKey, stop]);

  const play = async () => {
    const text = getText().trim();
    if (!text) {
      setError('There is no text to read yet.');
      return;
    }
    stopCurrentPlayer?.();
    stopCurrentPlayer = stop;
    setError('');
    const controller = new AbortController();
    activeRequest.current = controller;
    const signal = controller.signal;
    const current = () => activeRequest.current === controller;
    const online = ONLINE_VOICES.find((voice) => voice.id === voiceId);

    function playInBrowser(message: string) {
      const voice = online
        ? deviceVoices?.find((item) => item.lang.toLowerCase() === online.lang.toLowerCase())
        : deviceVoices?.find((item) => 'browser:' + item.voiceURI === voiceId);
      setPhase('browser');
      setNotice(message);
      try {
        clearDevice.current = speakOnDevice(text, speed, voice, voice?.lang ?? online?.lang, (failed) => {
          if (!current()) return;
          stop();
          if (failed) setError('This browser voice could not play. Try another voice.');
        });
        if (clearDevice.current) return;
      } catch {
        // Some platform voices fail before the browser can start playback.
      }
      stop();
      setError('Audio is unavailable. Try another voice or browser.');
    }

    if (!online) {
      playInBrowser('Playing with your browser voice.');
      return;
    }
    if (text.length > HOSTED_TEXT_LIMIT) {
      playInBrowser('Using a browser voice to read this long passage in full.');
      return;
    }
    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/mpeg')) {
      playInBrowser('Using your browser voice because streaming audio is unavailable.');
      return;
    }

    let playing = false;
    setPhase('preparing');
    const timeout = window.setTimeout(() => controller.abort(), START_TIMEOUT_MS);
    try {
      const response = await authFetch(getToken, '/api/tts/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(TtsRequestSchema.parse({ text, voice: online.id })),
        signal,
      });
      if (!response.ok || signal.aborted) throw new Error('Speech service unavailable');

      const media = new MediaSource();
      const url = URL.createObjectURL(media);
      const audio = new Audio();
      clearOnline.current = () => {
        audio.onended = null;
        audio.onerror = null;
        audio.ontimeupdate = null;
        audio.pause();
        URL.revokeObjectURL(url);
      };
      let fail: (reason: Error) => void = () => undefined;
      const failure = new Promise<never>((_resolve, reject) => {
        fail = reject;
      });
      signal.addEventListener('abort', () => fail(new Error('Audio cancelled')), { once: true });
      audio.onerror = () => fail(new Error('Audio unavailable'));
      const open = new Promise<SourceBuffer>((resolve, reject) => {
        media.addEventListener(
          'sourceopen',
          () => {
            try {
              resolve(media.addSourceBuffer('audio/mpeg'));
            } catch (error) {
              reject(error);
            }
          },
          { once: true, signal },
        );
      });
      audio.src = url;
      audio.playbackRate = speed;
      const buffer = await Promise.race([open, failure]);
      const ended = new Promise<void>((resolve) => {
        audio.onended = () => resolve();
      });
      const queue: ArrayBuffer[] = [];
      const timings: WordTiming[] = [];
      let complete = false;
      let firstBuffer: () => void = () => undefined;
      const ready = new Promise<void>((resolve) => {
        firstBuffer = resolve;
      });
      function flush() {
        if (buffer.updating || signal.aborted || media.readyState !== 'open') return;
        const next = queue.shift();
        if (next) buffer.appendBuffer(next);
        else if (complete) media.endOfStream();
      }
      buffer.addEventListener(
        'updateend',
        () => {
          firstBuffer();
          try {
            flush();
          } catch {
            fail(new Error('Audio decoding failed'));
          }
        },
        { signal },
      );
      buffer.addEventListener('error', () => fail(new Error('Audio decoding failed')), {
        once: true,
        signal,
      });
      const stream = consumeSpeechStream(
        response,
        (bytes) => {
          queue.push(new Uint8Array(bytes).buffer);
          flush();
        },
        (timing) => timings.push(timing),
      ).then(() => {
        complete = true;
        flush();
        if (!signal.aborted) setWords([...timings]);
      });

      await Promise.race([ready, failure, stream.then(() => ready)]);
      if (!current()) return;
      audio.ontimeupdate = () => {
        const ms = audio.currentTime * 1000;
        setActiveIndex(timings.findIndex((word) => ms >= word.start_ms && ms < word.end_ms));
        if (!complete) setWords([...timings]);
      };
      await Promise.race([audio.play(), failure]);
      if (!current()) return;
      playing = true;
      setPhase('online');
      window.clearTimeout(timeout);
      await Promise.race([Promise.all([stream, ended]), failure]);
      if (current()) stop();
    } catch {
      if (!current()) return;
      controller.abort();
      clearOnline.current?.();
      clearOnline.current = undefined;
      setWords([]);
      if (playing) {
        stop();
        setError('Audio was interrupted. Try again or select a browser voice.');
      } else {
        playInBrowser('The online voice was unavailable. Playing with your browser voice.');
      }
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const playing = phase !== 'idle';
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={() => (playing ? stop() : void play())}
          disabled={disabled && !playing}
          className="min-h-10 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-950 disabled:opacity-50"
        >
          {phase === 'preparing' ? 'Cancel audio' : playing ? 'Stop audio' : label}
        </button>
        <label className="min-w-0 text-sm font-medium text-slate-700">
          Voice
          <select
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value)}
            disabled={playing}
            className="mt-1 block max-w-full rounded-lg border border-slate-300 bg-white px-2 py-2"
          >
            <optgroup label="Online voices">
              {ONLINE_VOICES.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </optgroup>
            {deviceVoices && (
              <optgroup label="Browser voices">
                <option value="browser-default">Browser default</option>
                {deviceVoices.map((voice) => (
                  <option key={voice.voiceURI} value={'browser:' + voice.voiceURI}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Speed
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            disabled={playing}
            className="mt-1 block rounded-lg border border-slate-300 bg-white px-2 py-2"
          >
            {SPEEDS.map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </label>
      </div>
      {(phase === 'preparing' || notice) && (
        <p role="status" className="mt-2 text-sm text-slate-600">
          {notice || 'Preparing audio…'}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {words.length > 0 && phase === 'online' && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6" aria-hidden="true">
          {words.map((word, index) => (
            <span key={index} className={index === activeIndex ? 'rounded bg-yellow-200 px-0.5' : undefined}>
              {word.text}{' '}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
