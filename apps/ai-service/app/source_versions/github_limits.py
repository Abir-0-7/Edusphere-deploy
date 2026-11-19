"""Configurable finite import budgets, including a cooperative disconnect fence."""

import threading
import time
from dataclasses import dataclass

from app.errors import ApiError, TooLarge


@dataclass(frozen=True)
class ImportLimits:
    max_files: int = 8
    max_file_bytes: int = 131072
    max_total_bytes: int = 524288
    max_wire_bytes: int = 2097152
    max_response_bytes: int = 262144
    max_api_requests: int = 24
    max_path_depth: int = 6
    max_selected_lines: int = 1000
    request_timeout_seconds: float = 5
    total_timeout_seconds: float = 30


class ImportBudget:
    def __init__(self, limits: ImportLimits, cancelled: threading.Event | None = None):
        self.limits = limits
        self.cancelled = cancelled or threading.Event()
        self.deadline = time.monotonic() + limits.total_timeout_seconds
        self.requests = self.wire_bytes = self.file_bytes = 0

    def check(self) -> float:
        if self.cancelled.is_set():
            raise ApiError("Repository import was cancelled", status_code=409)
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise ApiError("Repository import timed out; choose fewer files", status_code=503)
        return remaining

    def take_request(self) -> None:
        self.check()
        if self.requests >= self.limits.max_api_requests:
            raise TooLarge("Selected paths require too many repository requests")
        self.requests += 1

    def consume_wire(self, count: int) -> None:
        self.check()
        self.wire_bytes += count
        if self.wire_bytes > self.limits.max_wire_bytes:
            raise TooLarge("Repository API transfer exceeds the import byte limit")

    def consume_file(self, count: int) -> None:
        self.check()
        if count > self.limits.max_file_bytes:
            raise TooLarge("A selected repository file exceeds the byte limit")
        self.file_bytes += count
        if self.file_bytes > self.limits.max_total_bytes:
            raise TooLarge("Selected repository files exceed the total byte limit")
