"""Atomic hourly admission and bounded active work for public GitHub imports.

Production admission uses Upstash only as a rate limiter. Both counters are
checked and debited in one Lua command; a rejected user never consumes the
shared allowance. A failed/uncertain request is not refunded or retried here.
"""

import hashlib
import json
import math
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import httpx

from app.errors import ApiError, RateLimited

if TYPE_CHECKING:
    from app.settings import Settings

_RESPONSE_BYTES = 4096


def _positive_limit(value: int) -> None:
    if type(value) is not int or not 1 <= value <= 2_147_483_647:
        raise ValueError("GitHub import limits must be positive bounded integers")


def _utc_now(now: datetime | None) -> datetime:
    current = now if now is not None else datetime.now(UTC)
    if not isinstance(current, datetime) or current.tzinfo is None or current.utcoffset() is None:
        raise ValueError("GitHub import timestamps must include a timezone")
    return current.astimezone(UTC)


def _owner_hash(user_id: str) -> str:
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("GitHub import admission requires an authenticated owner")
    return hashlib.sha256(user_id.encode("utf-8")).hexdigest()


def _hour_retry(current: datetime) -> int:
    boundary = current.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return max(1, math.ceil((boundary - current).total_seconds()))


def _denied(current: datetime) -> RateLimited:
    return RateLimited(
        "GitHub import allowance reached; try again after the hourly reset",
        {"reason": "github_import_hourly_limit", "retryAfterSeconds": _hour_retry(current)},
    )


class MemoryGithubImportLimiter:
    """Fixed UTC-hour windows for explicit development/test mode only.

    Only the latest hour's admitted owners are retained. The shared cap bounds
    that dictionary, and a stale timestamp cannot reopen an older allowance.
    """

    def __init__(self, per_user_limit: int, global_limit: int) -> None:
        _positive_limit(per_user_limit)
        _positive_limit(global_limit)
        self.per_user_limit, self.global_limit = per_user_limit, global_limit
        self._window: int | None = None
        self._counts: dict[str, int] = {}
        self._global_count = 0
        self._lock = threading.Lock()

    def check(self, user_id: str, now: datetime | None = None) -> None:
        current = _utc_now(now)
        window = int(current.timestamp()) // 3600
        owner = _owner_hash(user_id)
        with self._lock:
            if self._window is not None and window < self._window:
                raise _denied(current)
            if self._window is None or window > self._window:
                self._window = window
                self._counts.clear()
                self._global_count = 0
            used = self._counts.get(owner, 0)
            if used >= self.per_user_limit or self._global_count >= self.global_limit:
                raise _denied(current)
            self._counts[owner] = used + 1
            self._global_count += 1


_HOUR_SCRIPT = """
local function counter(key)
  local raw = redis.call('GET', key)
  if not raw then return 0 end
  if raw ~= '0' and not string.match(raw, '^[1-9]%d*$') then return nil end
  local count = tonumber(raw)
  if not count or count < 0 or count ~= math.floor(count) then return nil end
  return count
end
local user_used = counter(KEYS[1])
local global_used = counter(KEYS[2])
if not user_used or not global_used then return -1 end
if user_used >= tonumber(ARGV[1]) or global_used >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1
""".strip()


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate rate-limit response key")
        result[key] = value
    return result


class UpstashGithubImportLimiter:
    """One authenticated EVAL for both hourly counters, with no proxy/redirects."""

    def __init__(
        self,
        redis_url: str,
        redis_token: str,
        per_user_limit: int,
        global_limit: int,
        *,
        client_factory: Callable[..., httpx.Client] = httpx.Client,
    ) -> None:
        _positive_limit(per_user_limit)
        _positive_limit(global_limit)
        if not redis_url or not redis_token:
            raise ValueError("Upstash rate-limit URL and token are required")
        self.redis_url, self.redis_token = redis_url.rstrip("/"), redis_token
        self.per_user_limit, self.global_limit = per_user_limit, global_limit
        self.client_factory = client_factory

    def check(self, user_id: str, now: datetime | None = None) -> None:
        current = _utc_now(now)
        window = int(current.timestamp()) // 3600
        owner = _owner_hash(user_id)
        # The hash tag keeps both EVAL keys in the same Redis cluster slot.
        prefix = f"rl:{{github-import}}:hour:{window}"
        command = [
            "EVAL", _HOUR_SCRIPT, "2", f"{prefix}:owner:{owner}", f"{prefix}:global",
            str(self.per_user_limit), str(self.global_limit), str(_hour_retry(current) + 60),
        ]
        try:
            with self.client_factory(timeout=5.0, trust_env=False, follow_redirects=False) as client:
                with client.stream(
                    "POST", self.redis_url,
                    headers={"Authorization": f"Bearer {self.redis_token}", "Accept-Encoding": "identity"},
                    json=command,
                ) as response:
                    response.raise_for_status()
                    if response.headers.get("content-encoding", "identity").lower() != "identity":
                        raise ValueError("encoded rate-limit response")
                    content = bytearray()
                    for part in response.iter_bytes(chunk_size=_RESPONSE_BYTES):
                        if len(content) + len(part) > _RESPONSE_BYTES:
                            raise ValueError("rate-limit response too large")
                        content.extend(part)
                    payload = json.loads(content, object_pairs_hook=_unique_object)
            result = payload.get("result") if isinstance(payload, dict) and "error" not in payload else None
            if type(result) is not int or result not in {0, 1}:
                raise ValueError("invalid rate-limit service response")
        except (httpx.HTTPError, ValueError, RecursionError) as exc:
            # Do not log response content, owner identity, URL or credentials.
            raise ApiError("GitHub import usage checks are temporarily unavailable", status_code=503) from exc
        if result == 0:
            raise _denied(current)


def github_import_limiter(settings: "Settings") -> MemoryGithubImportLimiter | UpstashGithubImportLimiter:
    """Require shared admission only for enabled imports using durable storage.

    Disabled routes reject before admission, so they must not require optional
    Upstash credentials merely to start the existing PostgreSQL-backed API.
    """
    if settings.job_store == "memory" or not settings.github_import_enabled:
        return MemoryGithubImportLimiter(settings.github_import_per_user_hour, settings.github_import_global_hour)
    return UpstashGithubImportLimiter(
        settings.upstash_redis_rest_url or "", settings.upstash_redis_rest_token or "",
        settings.github_import_per_user_hour, settings.github_import_global_hour,
    )


class GithubImportSlots:
    """Use one instance per process; busy imports fail immediately instead of queueing."""

    def __init__(self, max_active: int) -> None:
        _positive_limit(max_active)
        self._slots = threading.BoundedSemaphore(max_active)

    @contextmanager
    def acquire(self) -> Iterator[None]:
        if not self._slots.acquire(blocking=False):
            raise RateLimited(
                "GitHub imports are busy; try again shortly",
                {"reason": "github_import_busy", "retryAfterSeconds": 1},
            )
        try:
            yield
        finally:
            self._slots.release()
