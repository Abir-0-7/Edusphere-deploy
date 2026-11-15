"""Structured logging (task 1.13): every line is valid JSON and usage events
carry provider, tokens and latency as fields (not just in the message text)."""

import json
import logging

from app.llm.router import UsageLog, UsageRecord
from app.logging_config import JsonFormatter


class _JsonCapture(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(JsonFormatter().format(record))


def _capture(logger_name: str) -> tuple[logging.Logger, _JsonCapture]:
    logger = logging.getLogger(logger_name)
    logger.setLevel(logging.INFO)
    handler = _JsonCapture()
    logger.addHandler(handler)
    return logger, handler


def test_usage_log_line_is_valid_json_and_carries_usage_fields() -> None:
    logger, handler = _capture("studyvault.test.logging")
    try:
        log = UsageLog()
        # Point the module-level logger at the test capture set.
        import app.llm.router as router_module

        original = router_module.logger
        router_module.logger = logger
        try:
            log.add(
                UsageRecord(
                    provider="groq",
                    model="llama-3.1-8b",
                    prompt_tokens=120,
                    completion_tokens=40,
                    latency_ms=812,
                )
            )
        finally:
            router_module.logger = original
    finally:
        logger.removeHandler(handler)

    assert len(handler.lines) == 1
    rec = json.loads(handler.lines[0])
    assert rec["provider"] == "groq"
    assert rec["model"] == "llama-3.1-8b"
    assert rec["prompt_tokens"] == 120
    assert rec["completion_tokens"] == 40
    assert rec["latency_ms"] == 812
    assert rec["level"] == "INFO"
    assert "ts" in rec and "msg" in rec


def test_special_chars_in_message_keep_line_valid_json() -> None:
    logger, handler = _capture("studyvault.test.logging.chars")
    try:
        logger.warning("jwt verification failed: %s", 'token "x" <bad>\nnewline')
    finally:
        logger.removeHandler(handler)

    assert len(handler.lines) == 1
    rec = json.loads(handler.lines[0])  # must not raise
    assert 'token "x" <bad>' in rec["msg"]


def test_exception_is_json_and_has_traceback() -> None:
    logger, handler = _capture("studyvault.test.logging.exc")
    try:
        try:
            raise ValueError("boom")
        except ValueError:
            logger.exception("worker loop iteration failed")
    finally:
        logger.removeHandler(handler)

    rec = json.loads(handler.lines[0])
    assert rec["level"] == "ERROR"
    assert "ValueError: boom" in rec["exception"]
