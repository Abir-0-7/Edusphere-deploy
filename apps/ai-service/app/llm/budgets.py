"""Atomic token budgets and generation leases; stores contain metadata only.

Expired leases free slots but retain their reserved token charge until a known
result is settled. This deliberately does not refund uncertain remote work.
"""

from __future__ import annotations

import math
import re
import threading
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

from app.errors import NotFound, RateLimited

# Transaction-scoped advisory lock serializes aggregate checks and mutations.
# No connection/session lock is held while a provider request executes.
_LOCK_KEY = 8315180493413013317


@dataclass(frozen=True)
class BudgetLimits:
    user_daily_tokens: int
    global_daily_tokens: int
    feature_daily_tokens: int
    user_active: int
    global_active: int
    lease_seconds: int

    def __post_init__(self) -> None:
        for value in vars(self).values():
            if type(value) is not int or value <= 0:
                raise ValueError("budget limits must be positive integers")


@dataclass(frozen=True)
class BudgetReservation:
    operation_id: str
    user_id: str
    feature: str
    budget_day: date
    reserved_tokens: int
    actual_tokens: int | None
    state: str
    expires_at: datetime


class BudgetStore(Protocol):
    def reserve(
        self, owner: str, operation_id: str, feature: str, reserved_tokens: int, limits: BudgetLimits
    ) -> BudgetReservation: ...

    def settle(self, owner: str, operation_id: str, actual_tokens: int) -> bool: ...

    def release(self, owner: str, operation_id: str) -> bool: ...


def _now(clock: Callable[[], datetime]) -> datetime:
    value = clock()
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("budget clock must be timezone aware")
    return value.astimezone(UTC)


def _scope(owner: str, operation_id: str) -> None:
    if not isinstance(owner, str) or not owner.strip() or not isinstance(operation_id, str) or not operation_id.strip():
        raise ValueError("budget reservation requires owner and operation id")


def _tokens(value: int, *, allow_zero: bool = False) -> None:
    if type(value) is not int or value < (0 if allow_zero else 1) or value > 2_147_483_647:
        raise ValueError("token count is outside the supported integer range")


def _daily_retry(now: datetime) -> int:
    tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    return max(1, math.ceil((tomorrow - now).total_seconds()))


def _denied(reason: str, retry: int) -> RateLimited:
    return RateLimited(
        "AI token budget reached; try again after the daily reset"
        if reason.endswith("budget")
        else "AI generation capacity is busy; retry shortly",
        {"reason": reason, "retryAfterSeconds": max(1, retry)},
    )


def _charge(row: BudgetReservation) -> int:
    if row.state == "released":
        return 0
    if row.state == "settled":
        return row.actual_tokens or 0
    return row.reserved_tokens


def _check(
    limits: BudgetLimits,
    tokens: int,
    now: datetime,
    totals: tuple[int, int, int],
    active: tuple[int, int],
    expiry: tuple[datetime | None, datetime | None],
) -> None:
    for reason, used, cap in (
        ("user_token_budget", totals[0], limits.user_daily_tokens),
        ("global_token_budget", totals[1], limits.global_daily_tokens),
        ("feature_token_budget", totals[2], limits.feature_daily_tokens),
    ):
        if used + tokens > cap:
            raise _denied(reason, _daily_retry(now))
    for reason, used, cap, next_expiry in (
        ("user_generation_capacity", active[0], limits.user_active, expiry[0]),
        ("global_generation_capacity", active[1], limits.global_active, expiry[1]),
    ):
        if used >= cap:
            retry = math.ceil((next_expiry - now).total_seconds()) if next_expiry else limits.lease_seconds
            raise _denied(reason, retry)


def _same(row: BudgetReservation, owner: str, feature: str, reserved_tokens: int) -> None:
    if (row.user_id, row.feature, row.reserved_tokens) != (owner, feature, reserved_tokens):
        raise ValueError("budget operation scope or reservation conflict")


class MemoryBudgetStore:
    """Thread-safe development/test store, never a production fallback."""

    def __init__(self, *, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self.clock = clock
        self.rows: dict[str, BudgetReservation] = {}
        self._lock = threading.Lock()

    def _expire(self, now: datetime) -> None:
        for key, row in list(self.rows.items()):
            if row.state == "reserved" and row.expires_at <= now:
                self.rows[key] = replace(row, state="expired")

    def reserve(
        self, owner: str, operation_id: str, feature: str, reserved_tokens: int, limits: BudgetLimits
    ) -> BudgetReservation:
        _scope(owner, operation_id)
        _tokens(reserved_tokens)
        if not isinstance(feature, str) or not feature.strip():
            raise ValueError("budget feature is required")
        now = _now(self.clock)
        with self._lock:
            self._expire(now)
            prior = self.rows.get(operation_id)
            if prior is not None:
                _same(prior, owner, feature, reserved_tokens)
                return prior
            today = [row for row in self.rows.values() if row.budget_day == now.date()]
            active = [row for row in self.rows.values() if row.state == "reserved"]
            owned = [row for row in active if row.user_id == owner]
            _check(
                limits,
                reserved_tokens,
                now,
                (
                    sum(_charge(row) for row in today if row.user_id == owner),
                    sum(_charge(row) for row in today),
                    sum(_charge(row) for row in today if row.feature == feature),
                ),
                (len(owned), len(active)),
                (
                    min((row.expires_at for row in owned), default=None),
                    min((row.expires_at for row in active), default=None),
                ),
            )
            row = BudgetReservation(
                operation_id,
                owner,
                feature,
                now.date(),
                reserved_tokens,
                None,
                "reserved",
                now + timedelta(seconds=limits.lease_seconds),
            )
            self.rows[operation_id] = row
            return row

    def settle(self, owner: str, operation_id: str, actual_tokens: int) -> bool:
        _scope(owner, operation_id)
        _tokens(actual_tokens, allow_zero=True)
        with self._lock:
            row = self.rows.get(operation_id)
            if row is None or row.user_id != owner:
                raise NotFound("AI budget reservation is unavailable")
            if row.state in {"settled", "released"}:
                return False
            if actual_tokens > row.reserved_tokens:
                raise ValueError("actual tokens exceed the reserved upper bound")
            self.rows[operation_id] = replace(row, state="settled", actual_tokens=actual_tokens)
            return True

    def release(self, owner: str, operation_id: str) -> bool:
        _scope(owner, operation_id)
        now = _now(self.clock)
        with self._lock:
            self._expire(now)
            row = self.rows.get(operation_id)
            if row is None or row.user_id != owner:
                raise NotFound("AI budget reservation is unavailable")
            if row.state != "reserved":
                return False
            self.rows[operation_id] = replace(row, state="released", actual_tokens=0)
            return True


class PgBudgetStore:
    """Short transactions serialize checks on the free-tier aggregate budget table.

    Only aggregate budget data crosses ownership scopes. Reservation reads and
    all writes are owner scoped; users FK plus owner key-share lock prevent late
    account resurrection. Optional identifiers support isolated integration tests.
    """

    def __init__(
        self,
        database_url: str,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        connection_factory: Callable[..., Any] | None = None,
        table: str = "ai_budget_reservations",
        owner_table: str = "users",
    ) -> None:
        for identifier in (table, owner_table):
            if re.fullmatch(r"[a-z_][a-z0-9_]*", identifier) is None:
                raise ValueError("budget table must be a simple lowercase identifier")
        self.database_url, self.clock = database_url, clock
        self.connection_factory = connection_factory
        self.table, self.owner_table = table, owner_table

    def _connect(self) -> Any:
        if self.connection_factory is None:
            import psycopg

            connect = psycopg.connect
        else:
            connect = self.connection_factory
        return connect(self.database_url, autocommit=True, connect_timeout=5)

    def _read(self, cur: Any, owner: str, operation_id: str) -> BudgetReservation | None:
        cur.execute(
            f"SELECT operation_id,user_id,feature,budget_day,reserved_tokens,actual_tokens,state,expires_at "
            f"FROM {self.table} WHERE operation_id=%s AND user_id=%s FOR UPDATE",
            (operation_id, owner),
        )
        values = cur.fetchone()
        if values is None:
            return None
        return BudgetReservation(str(values[0]), str(values[1]), *values[2:])

    def reserve(
        self, owner: str, operation_id: str, feature: str, reserved_tokens: int, limits: BudgetLimits
    ) -> BudgetReservation:
        _scope(owner, operation_id)
        _tokens(reserved_tokens)
        if not isinstance(feature, str) or not feature.strip():
            raise ValueError("budget feature is required")
        now = _now(self.clock)
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
            cur.execute(f"SELECT id FROM {self.owner_table} WHERE id=%s FOR KEY SHARE", (owner,))
            if cur.fetchone() is None:
                raise NotFound("AI budget owner is unavailable")
            # Expired slots are excluded by timestamp even if this annotation is
            # rolled back by a denial later in the transaction.
            cur.execute(
                f"UPDATE {self.table} SET state='expired',updated_at=%s "
                "WHERE user_id=%s AND state='reserved' AND expires_at<=%s",
                (now, owner, now),
            )
            prior = self._read(cur, owner, operation_id)
            if prior is not None:
                _same(prior, owner, feature, reserved_tokens)
                return prior
            charge = (
                "CASE WHEN state='settled' THEN actual_tokens WHEN state='released' THEN 0 ELSE reserved_tokens END"
            )
            cur.execute(
                f"SELECT COALESCE(SUM({charge}) FILTER (WHERE user_id=%s),0),"
                f"COALESCE(SUM({charge}),0),COALESCE(SUM({charge}) FILTER (WHERE feature=%s),0) "
                f"FROM {self.table} WHERE budget_day=%s",
                (owner, feature, now.date()),
            )
            totals = tuple(cur.fetchone())
            cur.execute(
                f"SELECT COUNT(*) FILTER (WHERE user_id=%s),COUNT(*),"
                f"MIN(expires_at) FILTER (WHERE user_id=%s),MIN(expires_at) FROM {self.table} "
                "WHERE state='reserved' AND expires_at>%s",
                (owner, owner, now),
            )
            active_owner, active_global, user_expiry, global_expiry = cur.fetchone()
            _check(limits, reserved_tokens, now, totals, (active_owner, active_global), (user_expiry, global_expiry))
            expiry = now + timedelta(seconds=limits.lease_seconds)
            cur.execute(
                f"INSERT INTO {self.table} "
                "(operation_id,user_id,feature,budget_day,reserved_tokens,state,expires_at,created_at,updated_at) "
                "VALUES(%s,%s,%s,%s,%s,'reserved',%s,%s,%s)",
                (operation_id, owner, feature, now.date(), reserved_tokens, expiry, now, now),
            )
            return BudgetReservation(
                operation_id, owner, feature, now.date(), reserved_tokens, None, "reserved", expiry
            )

    def settle(self, owner: str, operation_id: str, actual_tokens: int) -> bool:
        _scope(owner, operation_id)
        _tokens(actual_tokens, allow_zero=True)
        now = _now(self.clock)
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
            row = self._read(cur, owner, operation_id)
            if row is None:
                raise NotFound("AI budget reservation is unavailable")
            if row.state in {"settled", "released"}:
                return False
            if actual_tokens > row.reserved_tokens:
                raise ValueError("actual tokens exceed the reserved upper bound")
            cur.execute(
                f"UPDATE {self.table} SET state='settled',actual_tokens=%s,updated_at=%s "
                "WHERE operation_id=%s AND user_id=%s AND state IN ('reserved','expired')",
                (actual_tokens, now, operation_id, owner),
            )
            return cur.rowcount == 1

    def release(self, owner: str, operation_id: str) -> bool:
        _scope(owner, operation_id)
        now = _now(self.clock)
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
            row = self._read(cur, owner, operation_id)
            if row is None:
                raise NotFound("AI budget reservation is unavailable")
            if row.state != "reserved" or row.expires_at <= now:
                return False
            cur.execute(
                f"UPDATE {self.table} SET state='released',actual_tokens=0,updated_at=%s "
                "WHERE operation_id=%s AND user_id=%s AND state='reserved'",
                (now, operation_id, owner),
            )
            return cur.rowcount == 1
