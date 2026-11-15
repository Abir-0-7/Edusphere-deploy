"""Tests for TTS structure and the browser-fallback contract (tasks 4.1-4.3)."""

import pytest

from app.voice.tts import TICKS_PER_SECOND, Clip, TtsUnavailable, Word, ticks_to_ms


def test_ticks_convert_to_milliseconds() -> None:
    assert ticks_to_ms(TICKS_PER_SECOND) == 1000
    assert ticks_to_ms(TICKS_PER_SECOND // 2) == 500
    assert ticks_to_ms(0) == 0


def test_clip_serialises_word_boundaries_for_karaoke() -> None:
    clip = Clip(words=[Word("hello", 0, 300), Word("world", 300, 650)])
    assert clip.words_json() == [
        {"text": "hello", "start_ms": 0, "end_ms": 300},
        {"text": "world", "start_ms": 300, "end_ms": 650},
    ]


def test_empty_text_yields_empty_clip_not_an_error() -> None:
    import asyncio

    from app.voice.tts import synthesize

    clip = asyncio.run(synthesize("   "))
    assert clip.audio == b""
    assert clip.words == []


def test_missing_backend_raises_so_client_can_fall_back(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    import app.voice.tts as tts

    monkeypatch.setattr(tts, "edge_available", lambda: False)
    with pytest.raises(TtsUnavailable):
        asyncio.run(tts.synthesize("some text"))


def test_unavailable_backend_is_a_runtime_error_the_api_can_map() -> None:
    # The endpoint maps TtsUnavailable -> 503 and the UI falls back to
    # SpeechSynthesis; keep the hierarchy explicit so that mapping is stable.
    assert issubclass(TtsUnavailable, RuntimeError)


def test_stream_events_emits_audio_word_and_done(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio
    import sys
    import types

    class FakeCommunicate:
        def __init__(self, text: str, voice: str) -> None:
            self.text = text
            self.voice = voice

        async def stream(self):
            yield {"type": "audio", "data": b"mp3"}
            yield {"type": "WordBoundary", "offset": 0, "duration": 10_000_000, "text": "hello"}

    monkeypatch.setattr("app.voice.tts.edge_available", lambda: True)
    monkeypatch.setitem(sys.modules, "edge_tts", types.SimpleNamespace(Communicate=FakeCommunicate))
    events = asyncio.run(_collect_events())
    assert events[0].startswith("event: audio\ndata: ")
    assert '"text": "hello"' in events[1]
    assert events[-1] == "event: done\ndata: {}\n\n"


def test_tts_stream_endpoint_starts_incremental_response(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio
    import sys
    import types

    from fastapi.responses import StreamingResponse

    from app.main import text_to_speech_stream

    async def fake_stream(text: str, *, voice: str | None = None):
        yield "event: audio\ndata: bXA=\n\n"
        yield "event: done\ndata: {}\n\n"

    monkeypatch.setitem(sys.modules, "app.voice.tts", types.SimpleNamespace(
        TtsUnavailable=RuntimeError,
        edge_available=lambda: True,
        stream_events=fake_stream,
    ))
    response = asyncio.run(text_to_speech_stream({"text": "hello"}, "user"))
    assert isinstance(response, StreamingResponse)
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["x-accel-buffering"] == "no"


async def _collect_events() -> list[str]:
    from app.voice.tts import stream_events

    return [event async for event in stream_events("hello")]
