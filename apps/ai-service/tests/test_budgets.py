"""Budget cap races, terminal transitions, expiry and owner-scoped SQL."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest

from app.errors import NotFound, RateLimited
from app.llm.budgets import BudgetLimits, MemoryBudgetStore, PgBudgetStore

NOW = datetime(2026, 11, 18, 12, tzinfo=UTC)


def limits(**kw):
    values = dict(
        user_daily_tokens=1000,
        global_daily_tokens=10000,
        feature_daily_tokens=10000,
        user_active=10,
        global_active=100,
        lease_seconds=60,
    )
    return BudgetLimits(**(values | kw))


def memory():
    clock = [NOW]
    return MemoryBudgetStore(clock=lambda: clock[0]), clock


def outcome(call):
    try:
        return call()
    except RateLimited as exc:
        return exc


def test_concurrent_reservations_do_not_exceed_user_tokens_or_slots():
    store, _ = memory()
    caps = limits(user_daily_tokens=500, user_active=3)
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(
            pool.map(lambda _: outcome(lambda: store.reserve("alice", str(uuid.uuid4()), "chat", 100, caps)), range(50))
        )
    accepted = [row for row in results if not isinstance(row, RateLimited)]
    assert len(accepted) == 3
    assert all(exc.details["reason"] == "user_generation_capacity" for exc in results if isinstance(exc, RateLimited))
    assert sum(row.reserved_tokens for row in store.rows.values()) == 300


@pytest.mark.parametrize(
    "cap_name,cap,reason",
    [
        ("user_daily_tokens", 150, "user_token_budget"),
        ("global_daily_tokens", 150, "global_token_budget"),
        ("feature_daily_tokens", 150, "feature_token_budget"),
    ],
)
def test_token_budgets_are_enforced_atomically(cap_name, cap, reason):
    store, _ = memory()
    caps = limits(**{cap_name: cap})
    store.reserve("alice", "a", "chat", 100, caps)
    owner = "alice" if cap_name == "user_daily_tokens" else "bob"
    with pytest.raises(RateLimited) as denied:
        store.reserve(owner, "b", "chat", 100, caps)
    assert denied.value.details == {"reason": reason, "retryAfterSeconds": 43200}
    assert len(store.rows) == 1


def test_global_slots_cover_other_owners_and_features():
    store, _ = memory()
    caps = limits(global_active=1)
    store.reserve("alice", "a", "chat", 100, caps)
    with pytest.raises(RateLimited) as denied:
        store.reserve("bob", "b", "summary", 100, caps)
    assert denied.value.details == {"reason": "global_generation_capacity", "retryAfterSeconds": 60}


@pytest.mark.parametrize("cap_name", ["global_daily_tokens", "feature_daily_tokens"])
def test_shared_token_budget_races_across_owners(cap_name):
    store, _ = memory()
    caps = limits(**{cap_name: 300})
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(
            pool.map(
                lambda n: outcome(lambda: store.reserve(f"owner-{n}", f"operation-{n}", "chat", 100, caps)), range(40)
            )
        )
    assert sum(not isinstance(row, RateLimited) for row in results) == 3


def test_feature_caps_do_not_block_unrelated_feature():
    store, _ = memory()
    caps = limits(feature_daily_tokens=100)
    store.reserve("alice", "a", "chat", 100, caps)
    assert store.reserve("bob", "b", "summary", 100, caps).state == "reserved"


def test_expiry_frees_slot_but_preserves_uncertain_token_charge_and_never_reopens():
    store, clock = memory()
    caps = limits(user_active=1, user_daily_tokens=200)
    original = store.reserve("alice", "a", "chat", 150, caps)
    clock[0] += timedelta(seconds=60)
    replay = store.reserve("alice", "a", "chat", 150, caps)
    assert replay.state == "expired" and replay.expires_at == original.expires_at
    assert not store.release("alice", "a")
    with pytest.raises(RateLimited, match="budget"):
        store.reserve("alice", "b", "chat", 100, caps)
    assert store.reserve("alice", "b", "chat", 50, caps).state == "reserved"
    assert store.settle("alice", "a", 10)
    assert not store.settle("alice", "a", 100)
    assert store.rows["a"].actual_tokens == 10


def test_settle_release_race_has_one_effect_and_terminal_operations_do_not_reopen():
    store, _ = memory()
    caps = limits()
    store.reserve("alice", "a", "chat", 100, caps)
    with ThreadPoolExecutor(max_workers=16) as pool:
        applied = list(
            pool.map(lambda n: store.settle("alice", "a", 20) if n % 2 else store.release("alice", "a"), range(50))
        )
    assert sum(applied) == 1
    terminal = store.rows["a"]
    assert terminal.state in {"settled", "released"}
    assert store.reserve("alice", "a", "chat", 100, caps) == terminal


def test_known_unused_release_refunds_tokens_and_slots_only_once():
    store, _ = memory()
    caps = limits(user_daily_tokens=100, user_active=1)
    store.reserve("alice", "a", "chat", 100, caps)
    assert store.release("alice", "a") and not store.release("alice", "a")
    assert not store.settle("alice", "a", 50)
    assert store.reserve("alice", "b", "chat", 100, caps).state == "reserved"


def test_midnight_resets_tokens_but_an_old_active_slot_still_counts():
    store, clock = memory()
    clock[0] = NOW.replace(hour=23, minute=59, second=50)
    caps = limits(user_daily_tokens=100, user_active=1)
    store.reserve("alice", "a", "chat", 100, caps)
    clock[0] += timedelta(seconds=20)
    with pytest.raises(RateLimited) as denied:
        store.reserve("alice", "b", "chat", 100, caps)
    assert denied.value.details["reason"] == "user_generation_capacity"
    clock[0] += timedelta(seconds=40)
    assert store.reserve("alice", "b", "chat", 100, caps).budget_day == clock[0].date()


def test_cross_owner_conflict_and_over_reservation_settlement_are_rejected():
    store, _ = memory()
    store.reserve("alice", "a", "chat", 100, limits())
    with pytest.raises(ValueError, match="conflict"):
        store.reserve("bob", "a", "chat", 100, limits())
    with pytest.raises(NotFound):
        store.settle("bob", "a", 10)
    with pytest.raises(NotFound):
        store.release("bob", "a")
    with pytest.raises(ValueError, match="upper bound"):
        store.settle("alice", "a", 101)
    assert store.rows["a"].state == "reserved"


@pytest.mark.parametrize("value", [0, -1, True])
def test_invalid_limits_fail_before_storage(value):
    with pytest.raises(ValueError):
        limits(user_active=value)


def mock_pg(rows):
    cur = MagicMock()
    cur.__enter__.return_value = cur
    cur.fetchone.side_effect = rows
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value = cur
    connect = MagicMock(return_value=conn)
    return PgBudgetStore("unused", clock=lambda: NOW, connection_factory=connect), conn, cur, connect


def test_pg_reserve_serializes_aggregate_check_then_owner_scoped_insert_in_one_transaction():
    store, conn, cur, connect = mock_pg([("alice",), None, (0, 0, 0), (0, 0, None, None)])
    row = store.reserve("alice", "a", "chat", 100, limits())
    assert row.state == "reserved"
    connect.assert_called_once_with("unused", autocommit=True, connect_timeout=5)
    conn.transaction.assert_called_once()
    queries = [call.args for call in cur.execute.call_args_list]
    assert "pg_advisory_xact_lock" in queries[0][0]
    assert "WHERE id=%s FOR KEY SHARE" in queries[1][0] and queries[1][1] == ("alice",)
    assert "WHERE user_id=%s AND state='reserved'" in queries[2][0]
    assert queries[2][1] == (NOW, "alice", NOW)
    assert "WHERE operation_id=%s AND user_id=%s FOR UPDATE" in queries[3][0]
    assert "budget_day=%s" in queries[4][0] and queries[4][1] == ("alice", "chat", NOW.date())
    assert "state='reserved' AND expires_at>%s" in queries[5][0]
    assert queries[-1][1][:5] == ("a", "alice", "chat", NOW.date(), 100)


def test_pg_settlement_and_release_are_owner_scoped_conditional_terminal_updates():
    reserved = ("a", "alice", "chat", NOW.date(), 100, None, "reserved", NOW + timedelta(seconds=60))
    store, _, cur, _ = mock_pg([reserved])
    cur.rowcount = 1
    assert store.settle("alice", "a", 20)
    sql, params = cur.execute.call_args.args
    assert "operation_id=%s AND user_id=%s AND state IN ('reserved','expired')" in sql
    assert params == (20, NOW, "a", "alice")
    store, _, cur, _ = mock_pg([reserved])
    cur.rowcount = 1
    assert store.release("alice", "a")
    sql, params = cur.execute.call_args.args
    assert "operation_id=%s AND user_id=%s AND state='reserved'" in sql
    assert params == (NOW, "a", "alice")


def test_pg_outage_propagates_and_invalid_identifier_does_not_connect():
    with pytest.raises(ValueError):
        PgBudgetStore("unused", table="bad;DROP TABLE users")
    store, _, _, connect = mock_pg([])
    connect.side_effect = ConnectionError("offline")
    with pytest.raises(ConnectionError):
        store.reserve("alice", "a", "chat", 100, limits())
