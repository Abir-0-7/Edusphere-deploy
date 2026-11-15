"""Text-to-speech (tasks 4.1-4.3).

Primary backend: `edge-tts` (free, no API key). If the package is missing or the
synthesis fails, `synthesize` raises `TtsUnavailable` and the client falls back
to the browser's SpeechSynthesis — the fallback is part of the contract, not an
afterthought.

edge-tts emits `WordBoundary` events (offset in 100 ns ticks, duration, text), so
the caller gets the word timings the karaoke highlighter needs alongside the
audio, without a second pass.
"""

import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("studyvault.tts")

DEFAULT_VOICE = "en-US-AriaNeural"
# 100 ns ticks per second (edge-tts metadata unit).
TICKS_PER_SECOND = 10_000_000
MAX_CHARS = 5000


class TtsUnavailable(RuntimeError):
    """Raised when no server-side TTS backend can produce audio."""


@dataclass(frozen=True)
class Word:
    text: str
    start_ms: int
    end_ms: int


@dataclass
class Clip:
    audio: bytes = b""
    words: list[Word] = field(default_factory=list)
    content_type: str = "audio/mpeg"

    def words_json(self) -> list[dict[str, Any]]:
        return [{"text": w.text, "start_ms": w.start_ms, "end_ms": w.end_ms} for w in self.words]


def ticks_to_ms(ticks: int) -> int:
    return int(round(ticks / TICKS_PER_SECOND * 1000))


def edge_available() -> bool:
    try:
        import edge_tts  # noqa: F401

        return True
    except ImportError:
        return False


def _voiced_chunks(chunk: dict[str, Any], audio: bytearray, words: list[Word]) -> None:
    if chunk["type"] == "audio":
        audio.extend(chunk["data"])
    elif chunk["type"] == "WordBoundary":
        start = ticks_to_ms(int(chunk["offset"]))
        words.append(
            Word(text=chunk["text"], start_ms=start, end_ms=start + ticks_to_ms(int(chunk["duration"])))
        )


async def synthesize(text: str, *, voice: str | None = None) -> Clip:
    """Return the whole clip (audio + word timings). Raises TtsUnavailable."""
    if not text.strip():
        return Clip()
    if not edge_available():
        raise TtsUnavailable("edge-tts is not installed")
    import edge_tts

    communicate = edge_tts.Communicate(text[:MAX_CHARS], voice or DEFAULT_VOICE)
    audio = bytearray()
    words: list[Word] = []
    async for chunk in communicate.stream():
        _voiced_chunks(chunk, audio, words)
    if not audio:
        raise TtsUnavailable("edge-tts returned no audio")
    return Clip(audio=bytes(audio), words=words)


async def stream_events(text: str, *, voice: str | None = None) -> AsyncIterator[str]:
    """Yield SSE audio and word events as edge-tts produces them."""
    if not text.strip():
        raise ValueError("text is required")
    if not edge_available():
        raise TtsUnavailable("edge-tts is not installed")
    import edge_tts

    communicate = edge_tts.Communicate(text[:MAX_CHARS], voice or DEFAULT_VOICE)
    yielded_audio = False
    async for chunk in communicate.stream():
        if chunk["type"] == "audio" and chunk["data"]:
            yielded_audio = True
            data = base64.b64encode(chunk["data"]).decode("ascii")
            yield f"event: audio\ndata: {data}\n\n"
        elif chunk["type"] == "WordBoundary":
            start = ticks_to_ms(int(chunk["offset"]))
            word = Word(text=chunk["text"], start_ms=start, end_ms=start + ticks_to_ms(int(chunk["duration"])))
            yield f"event: word\ndata: {json.dumps(word.__dict__, ensure_ascii=True)}\n\n"
    if not yielded_audio:
        raise TtsUnavailable("edge-tts returned no audio")
    yield "event: done\ndata: {}\n\n"


def synthesize_sync(text: str, *, voice: str | None = None) -> Clip:
    """Blocking wrapper for the job worker and tests."""
    return asyncio.run(synthesize(text, voice=voice))
