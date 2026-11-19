"""Owner-scoped bounded response cache; migrations own its database schema.

The caller hashes the complete versioned prompt/model/resource scope into a key.
Only the generated response is stored. All cache operations require explicit
trusted ownership; they neither infer users from cache keys nor create accounts.
"""

import re
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol


class ScopedResponseCache(Protocol):
    def get(self, user_id: str, cache_key: str, document_id: str | None = None,
            *, generation_run_id: str | None = None) -> str | None: ...
    def put(
        self, user_id: str, cache_key: str, content: str, ttl_seconds: int, document_id: str | None = None,
        *, generation_run_id: str | None = None,
    ) -> bool: ...
    def invalidate_user(self, user_id: str) -> None: ...
    def invalidate_document(self, user_id: str, document_id: str) -> None: ...


def _now(clock: Callable[[], datetime]) -> datetime:
    now = clock()
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("cache clock must include a timezone")
    return now.astimezone(UTC)


def _owner(user_id: str) -> None:
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("cache requires an authenticated owner")


def _document(document_id: str | None) -> None:
    if document_id is not None and (not isinstance(document_id, str) or not document_id.strip()):
        raise ValueError("cache document scope must be a non-empty identifier or None")


def _key(user_id: str, cache_key: str, document_id: str | None) -> None:
    _owner(user_id)
    if not isinstance(cache_key, str) or re.fullmatch(r"[a-f0-9]{64}", cache_key) is None:
        raise ValueError("cache key must be a lowercase SHA-256 digest")
    _document(document_id)


def _positive(value: int, name: str) -> None:
    if type(value) is not int or value <= 0:
        raise ValueError(f"{name} must be a positive integer")


@dataclass(frozen=True)
class _Entry:
    content: str
    expires_at: datetime
    updated_at: datetime
    document_id: str | None
    generation_run_id: str | None = None


class MemoryResponseCache:
    """Explicit development/test cache; never selected as a durable fallback."""

    def __init__(
        self,
        *,
        max_content_chars: int,
        max_entries_per_user: int,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        _positive(max_content_chars, "max_content_chars")
        _positive(max_entries_per_user, "max_entries_per_user")
        self.max_content_chars = max_content_chars
        self.max_entries_per_user = max_entries_per_user
        self.clock = clock
        self._entries: dict[tuple[str, str], _Entry] = {}
        self._lock = threading.Lock()

    def get(self, user_id: str, cache_key: str, document_id: str | None = None,
            *, generation_run_id: str | None = None) -> str | None:
        _key(user_id, cache_key, document_id)
        now = _now(self.clock)
        with self._lock:
            entry = self._entries.get((user_id, cache_key))
            if entry is None:
                return None
            if entry.expires_at <= now:
                self._entries.pop((user_id, cache_key))
                return None
            if entry.document_id != document_id or entry.generation_run_id != generation_run_id:
                return None
            return entry.content

    def put(self, user_id: str, cache_key: str, content: str, ttl_seconds: int, document_id: str | None = None,
            *, generation_run_id: str | None = None) -> bool:
        _key(user_id, cache_key, document_id)
        _positive(ttl_seconds, "ttl_seconds")
        if not isinstance(content, str):
            raise ValueError("cache content must be text")
        if not content or len(content) > self.max_content_chars:
            return False
        now = _now(self.clock)
        expires_at = now + timedelta(seconds=ttl_seconds)
        with self._lock:
            expired = [key for key, value in self._entries.items() if key[0] == user_id and value.expires_at <= now]
            for key in expired:
                self._entries.pop(key)
            existing = self._entries.get((user_id, cache_key))
            if existing is not None and (existing.document_id != document_id
                                         or existing.generation_run_id != generation_run_id):
                return False
            owned = [key for key in self._entries if key[0] == user_id]
            excess = len(owned) - self.max_entries_per_user + ((user_id, cache_key) not in self._entries)
            evictable = sorted(
                (key for key in owned if key != (user_id, cache_key)),
                key=lambda key: (self._entries[key].updated_at, key[1]),
            )
            for key in evictable[: max(0, excess)]:
                self._entries.pop(key)
            self._entries[user_id, cache_key] = _Entry(content, expires_at, now, document_id, generation_run_id)
            return True

    def invalidate_user(self, user_id: str) -> None:
        _owner(user_id)
        with self._lock:
            for key in [key for key in self._entries if key[0] == user_id]:
                self._entries.pop(key)

    def invalidate_document(self, user_id: str, document_id: str) -> None:
        _owner(user_id)
        _document(document_id)
        with self._lock:
            for key in [
                key for key, entry in self._entries.items() if key[0] == user_id and entry.document_id == document_id
            ]:
                self._entries.pop(key)


class PgResponseCache:
    """Per-operation connections and owner locks prevent cap/deletion write races.

    Runtime uses the migrated users/ai_response_cache tables. Safe alternate table
    identifiers and a connection factory support isolated integration/unit tests.
    A cache outage raises to the caller; this store never silently switches to RAM.
    """

    def __init__(
        self,
        database_url: str,
        *,
        max_content_chars: int,
        max_entries_per_user: int,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        table: str = "ai_response_cache",
        owner_table: str = "users",
        document_table: str = "documents",
        connection_factory: Callable[..., Any] | None = None,
    ) -> None:
        for name in (table, owner_table, document_table):
            if re.fullmatch(r"[a-z_][a-z0-9_]*", name) is None:
                raise ValueError("cache tables must be simple lowercase identifiers")
        _positive(max_content_chars, "max_content_chars")
        _positive(max_entries_per_user, "max_entries_per_user")
        self.database_url = database_url
        self.max_content_chars = max_content_chars
        self.max_entries_per_user = max_entries_per_user
        self.clock = clock
        self.table = table
        self.owner_table = owner_table
        self.document_table = document_table
        self.connection_factory = connection_factory

    def _connect(self) -> Any:
        if self.connection_factory is None:
            import psycopg

            connect = psycopg.connect
        else:
            connect = self.connection_factory
        return connect(self.database_url, autocommit=True, connect_timeout=5)

    def get(self, user_id: str, cache_key: str, document_id: str | None = None,
            *, generation_run_id: str | None = None) -> str | None:
        _key(user_id, cache_key, document_id)
        now = _now(self.clock)
        with self._connect() as conn, conn.cursor() as cur:
            generation_filter = " AND c.generation_run_id=%s" if generation_run_id is not None else ""
            cur.execute(
                f"SELECT c.content FROM {self.table} c JOIN {self.owner_table} u ON u.id=c.user_id"
                f" LEFT JOIN {self.document_table} d ON d.id=c.document_id AND d.user_id=c.user_id"
                " WHERE c.user_id=%s AND c.cache_key=%s AND c.expires_at>%s"
                " AND c.document_id IS NOT DISTINCT FROM %s AND (c.document_id IS NULL OR d.id IS NOT NULL)"
                + generation_filter,
                (user_id, cache_key, now, document_id, *((generation_run_id,) if generation_run_id else ())),
            )
            row = cur.fetchone()
        if row is None:
            return None
        content = row[0]
        return content if isinstance(content, str) and 0 < len(content) <= self.max_content_chars else None

    def put(self, user_id: str, cache_key: str, content: str, ttl_seconds: int, document_id: str | None = None,
            *, generation_run_id: str | None = None) -> bool:
        _key(user_id, cache_key, document_id)
        _positive(ttl_seconds, "ttl_seconds")
        if not isinstance(content, str):
            raise ValueError("cache content must be text")
        if not content or len(content) > self.max_content_chars:
            return False
        now = _now(self.clock)
        expires_at = now + timedelta(seconds=ttl_seconds)
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            # Serialize writes per owner before pruning/eviction/upsert. Account
            # deletion either follows this transaction and cascades, or wins and
            # leaves no owner, so a late response cannot recreate private content.
            cur.execute(f"SELECT id FROM {self.owner_table} WHERE id=%s FOR UPDATE", (user_id,))
            if cur.fetchone() is None:
                return False
            if document_id is not None:
                cur.execute(
                    f"SELECT id FROM {self.document_table} WHERE id=%s AND user_id=%s FOR KEY SHARE",
                    (document_id, user_id),
                )
                if cur.fetchone() is None:
                    return False
            if generation_run_id is not None:
                cur.execute("SELECT id FROM course_generation_runs WHERE id=%s AND user_id=%s FOR KEY SHARE",
                            (generation_run_id, user_id))
                if cur.fetchone() is None:
                    return False
            cur.execute(f"DELETE FROM {self.table} WHERE user_id=%s AND expires_at<=%s", (user_id, now))
            cur.execute(
                f"SELECT cache_key, document_id FROM {self.table} WHERE user_id=%s ORDER BY updated_at, cache_key",
                (user_id,),
            )
            stored = {key: str(doc) if doc is not None else None for key, doc in cur.fetchall()}
            if cache_key in stored and stored[cache_key] != document_id:
                return False
            # Enforce a lowered configuration cap as well as limiting new keys.
            excess = len(stored) - self.max_entries_per_user + (cache_key not in stored)
            evictable = [key for key in stored if key != cache_key]
            for old_key in evictable[: max(0, excess)]:
                cur.execute(f"DELETE FROM {self.table} WHERE user_id=%s AND cache_key=%s", (user_id, old_key))
            columns = ", generation_run_id" if generation_run_id is not None else ""
            values = ",%s" if generation_run_id is not None else ""
            generation_filter = (f" AND {self.table}.generation_run_id IS NOT DISTINCT FROM EXCLUDED.generation_run_id"
                                 if generation_run_id is not None else "")
            cur.execute(
                f"INSERT INTO {self.table}"
                f" (user_id, document_id, cache_key, content, expires_at, created_at, updated_at{columns})"
                f" VALUES (%s,%s,%s,%s,%s,%s,%s{values}) ON CONFLICT (user_id, cache_key) DO UPDATE"
                " SET content=EXCLUDED.content, expires_at=EXCLUDED.expires_at, updated_at=EXCLUDED.updated_at"
                f" WHERE {self.table}.document_id IS NOT DISTINCT FROM EXCLUDED.document_id"
                + generation_filter + " RETURNING cache_key",
                (user_id, document_id, cache_key, content, expires_at, now, now,
                 *((generation_run_id,) if generation_run_id else ())),
            )
            return cur.fetchone() is not None

    def invalidate_user(self, user_id: str) -> None:
        _owner(user_id)
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(f"DELETE FROM {self.table} WHERE user_id=%s", (user_id,))

    def invalidate_document(self, user_id: str, document_id: str) -> None:
        _owner(user_id)
        _document(document_id)
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"DELETE FROM {self.table} WHERE user_id=%s AND document_id=%s",
                (user_id, document_id),
            )
