"""Durable operation deduplication with conservative uncertain-provider recovery."""

import hashlib
import json
import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta
from typing import Any

from app.errors import ApiError, RateLimited

logger = logging.getLogger("studyvault.ai.operations")
_request_key: ContextVar[str | None] = ContextVar("ai_request_key", default=None)


@contextmanager
def operation_scope(key: str) -> Iterator[None]:
    token = _request_key.set(key)
    try:
        yield
    finally:
        _request_key.reset(token)


def operation_key(owner: str, payload: dict[str, Any]) -> str | None:
    parent = _request_key.get()
    if parent is None:
        return None
    # A validation re-ask and each bounded chapter are distinct sub-operations;
    # identical work retried under the same request/job key reuses its settlement.
    return hashlib.sha256(json.dumps([owner, parent, payload], sort_keys=True).encode()).hexdigest()


def _waiting(state: str) -> RateLimited:
    return RateLimited(
        "AI operation is still running"
        if state == "reserved"
        else "Previous provider outcome is uncertain; retry with a new operation key after checking the saved result",
        {"reason": "operation_pending" if state == "reserved" else "operation_uncertain", "retryAfterSeconds": 60},
    )


class MemoryOperations:
    def __init__(self, lease_seconds: int = 300) -> None:
        self.rows: dict[tuple[str, str], dict[str, Any]] = {}
        self.lease_seconds = lease_seconds
        self.lock = threading.Lock()

    def claim(self, owner: str, key: str, document_id: str | None = None) -> tuple[bool, str | None]:
        now = datetime.now(UTC)
        with self.lock:
            row = self.rows.get((owner, key))
            if row is None:
                self.rows[owner, key] = {
                    "state": "reserved",
                    "result": None,
                    "expires": now + timedelta(seconds=self.lease_seconds),
                }
                return True, None
            if row["state"] == "succeeded":
                return False, row["result"]
            if row["state"] == "reserved" and row["expires"] <= now:
                row["state"] = "uncertain"
            raise _waiting(row["state"])

    def settle(self, owner: str, key: str, result: str | None, attempted: bool) -> None:
        with self.lock:
            row = self.rows.get((owner, key))
            if row is None or row["state"] != "reserved":
                return
            if result is None and not attempted:
                del self.rows[owner, key]  # unused reservation; retry is safe
            else:
                row.update(state="succeeded" if result is not None else "uncertain", result=result)


class PgOperations:
    def __init__(self, database_url: str, lease_seconds: int = 300) -> None:
        self.database_url, self.lease_seconds = database_url, lease_seconds

    def _connect(self):
        import psycopg

        return psycopg.connect(self.database_url, autocommit=True, connect_timeout=5)

    def claim(self, owner: str, key: str, document_id: str | None = None) -> tuple[bool, str | None]:
        now = datetime.now(UTC)
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s FOR KEY SHARE", (owner,))
            if cur.fetchone() is None:
                raise ApiError("AI operation owner is unavailable", status_code=404)
            if document_id is not None:
                cur.execute("SELECT id FROM documents WHERE id=%s AND user_id=%s FOR KEY SHARE", (document_id, owner))
                if cur.fetchone() is None:
                    raise ApiError("AI operation source is unavailable", status_code=404)
            cur.execute(
                "INSERT INTO ai_operations(user_id,document_id,operation_key,state,expires_at) "
                "VALUES(%s,%s,%s,'reserved',%s) ON CONFLICT(user_id,operation_key) DO NOTHING RETURNING operation_key",
                (owner, document_id, key, now + timedelta(seconds=self.lease_seconds)),
            )
            if cur.fetchone() is not None:
                return True, None
            cur.execute(
                "SELECT state,result,expires_at FROM ai_operations WHERE user_id=%s AND operation_key=%s FOR UPDATE",
                (owner, key),
            )
            state, result, expiry = cur.fetchone()
            if state == "succeeded":
                return False, result
            if state == "reserved" and expiry <= now:
                cur.execute(
                    "UPDATE ai_operations SET state='uncertain',updated_at=now() WHERE user_id=%s AND operation_key=%s",
                    (owner, key),
                )
                state = "uncertain"
            # Raising here rolls back only the state annotation; expiry itself
            # still prevents retrying an uncertain remote call.
        raise _waiting(state)

    def settle(self, owner: str, key: str, result: str | None, attempted: bool) -> None:
        with self._connect() as conn, conn.cursor() as cur:
            if result is None and not attempted:
                cur.execute(
                    "DELETE FROM ai_operations WHERE user_id=%s AND operation_key=%s AND state='reserved'", (owner, key)
                )
            else:
                cur.execute(
                    "UPDATE ai_operations SET state=%s,result=%s,updated_at=now() "
                    "WHERE user_id=%s AND operation_key=%s AND state='reserved'",
                    ("succeeded" if result is not None else "uncertain", result, owner, key),
                )


def unavailable(exc: Exception) -> ApiError:
    logger.error("AI operation store unavailable: %s", type(exc).__name__)
    return ApiError("AI operation tracking is temporarily unavailable", status_code=503)
