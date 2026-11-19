"""Private generated-text cache isolation, expiry, boundedness and SQL scope."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest

from app.llm.response_cache import MemoryResponseCache, PgResponseCache

NOW = datetime(2026, 11, 17, tzinfo=UTC)
A = "a" * 64
B = "b" * 64
C = "c" * 64


def memory(*, limit=2, content_limit=100):
    clock = [NOW]
    return MemoryResponseCache(
        max_content_chars=content_limit, max_entries_per_user=limit, clock=lambda: clock[0]
    ), clock


def test_memory_is_owner_document_scoped_and_expires_at_boundary():
    cache, clock = memory()
    assert cache.put("alice", A, "private answer", 60, "doc-a")
    assert cache.get("alice", A, "doc-a") == "private answer"
    assert cache.get("bob", A, "doc-a") is None
    assert cache.get("alice", A, "doc-b") is None
    assert cache.get("alice", A) is None
    assert not cache.put("alice", A, "wrong document", 60, "doc-b")
    assert cache.get("alice", A, "doc-a") == "private answer"
    clock[0] += timedelta(seconds=60)
    assert cache.get("alice", A, "doc-a") is None


def test_memory_evicts_oldest_within_owner_and_updates_do_not_inflate_cap():
    cache, clock = memory()
    assert cache.put("alice", A, "first", 60)
    assert cache.put("bob", A, "other", 60)
    clock[0] += timedelta(seconds=1)
    assert cache.put("alice", B, "second", 60)
    clock[0] += timedelta(seconds=1)
    assert cache.put("alice", A, "updated", 60)
    clock[0] += timedelta(seconds=1)
    assert cache.put("alice", C, "third", 60)
    assert cache.get("alice", A) == "updated"
    assert cache.get("alice", B) is None
    assert cache.get("alice", C) == "third"
    assert cache.get("bob", A) == "other"
    cache.invalidate_user("alice")
    assert cache.get("alice", A) is None
    assert cache.get("bob", A) == "other"


def test_memory_document_invalidation_cannot_remove_other_sources_or_owners():
    cache, _ = memory()
    assert cache.put("alice", A, "one", 60, "doc-one")
    assert cache.put("alice", B, "two", 60, "doc-two")
    assert cache.put("bob", A, "other account", 60, "doc-one")
    cache.invalidate_document("alice", "doc-one")
    assert cache.get("alice", A, "doc-one") is None
    assert cache.get("alice", B, "doc-two") == "two"
    assert cache.get("bob", A, "doc-one") == "other account"


def test_memory_prunes_expired_before_evicting_live_entries_and_rejects_large_content():
    cache, clock = memory(content_limit=5)
    assert cache.put("alice", A, "short", 1)
    assert cache.put("alice", B, "live", 60)
    assert not cache.put("alice", C, "too long", 60)
    assert not cache.put("alice", C, "", 60)
    clock[0] += timedelta(seconds=1)
    assert cache.put("alice", C, "new", 60)
    assert cache.get("alice", B) == "live"


def test_memory_concurrent_writes_respect_per_owner_cap():
    cache, _ = memory(limit=3)
    with ThreadPoolExecutor(max_workers=12) as pool:
        assert all(pool.map(lambda n: cache.put("alice", f"{n:064x}", str(n), 60), range(50)))
    assert sum(cache.get("alice", f"{n:064x}") is not None for n in range(50)) == 3


@pytest.mark.parametrize("owner,key,doc", [("", A, None), ("alice", "raw prompt", None), ("alice", A, "")])
def test_invalid_scope_is_not_queried(owner, key, doc):
    cache, _ = memory()
    with pytest.raises(ValueError):
        cache.get(owner, key, doc)


@pytest.mark.parametrize("value", [0, -1, True])
def test_invalid_limits_and_ttl_cannot_disable_bounds(value):
    with pytest.raises(ValueError):
        MemoryResponseCache(max_content_chars=value, max_entries_per_user=2)
    cache, _ = memory()
    with pytest.raises(ValueError):
        cache.put("alice", A, "answer", value)


def mock_pg(*, rows=None):
    cur = MagicMock()
    cur.__enter__.return_value = cur
    cur.fetchone.side_effect = rows or [("alice",), (A,)]
    cur.fetchall.return_value = []
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value = cur
    connect = MagicMock(return_value=conn)
    cache = PgResponseCache(
        "not-a-real-connection",
        max_content_chars=100,
        max_entries_per_user=2,
        clock=lambda: NOW,
        connection_factory=connect,
    )
    return cache, cur, conn, connect


def test_pg_read_requires_owner_key_document_permission_and_unexpired_content():
    cache, cur, _, _ = mock_pg(rows=[("answer",)])
    assert cache.get("alice", A, "doc") == "answer"
    sql, params = cur.execute.call_args.args
    assert "c.user_id=%s AND c.cache_key=%s" in sql
    assert "c.document_id IS NOT DISTINCT FROM %s" in sql
    assert "d.user_id=c.user_id" in sql and "c.expires_at>%s" in sql
    assert params == ("alice", A, NOW, "doc")


def test_pg_write_locks_owner_before_document_and_scopes_expiry_eviction_upsert():
    cache, cur, conn, connect = mock_pg(rows=[("alice",), ("doc",), (A,)])
    assert cache.put("alice", A, "answer", 60, "doc")
    connect.assert_called_once_with("not-a-real-connection", autocommit=True, connect_timeout=5)
    conn.transaction.assert_called_once()
    queries = [call.args for call in cur.execute.call_args_list]
    assert "FROM users WHERE id=%s FOR UPDATE" in queries[0][0] and queries[0][1] == ("alice",)
    assert "WHERE id=%s AND user_id=%s FOR KEY SHARE" in queries[1][0]
    assert queries[1][1] == ("doc", "alice")
    assert queries[2][1] == ("alice", NOW)
    assert "user_id=%s" in queries[2][0] and "expires_at<=%s" in queries[2][0]
    insert, params = queries[-1]
    assert "ON CONFLICT (user_id, cache_key)" in insert
    assert "document_id IS NOT DISTINCT FROM EXCLUDED.document_id" in insert
    assert params == ("alice", "doc", A, "answer", NOW + timedelta(seconds=60), NOW, NOW)


@pytest.mark.parametrize("rows", [[None], [("alice",), None]])
def test_pg_write_does_not_recreate_deleted_or_unauthorized_owner_document(rows):
    cache, cur, _, _ = mock_pg(rows=rows)
    assert not cache.put("alice", A, "answer", 60, "doc")
    assert len(cur.execute.call_args_list) == len(rows)
    assert all("INSERT" not in call.args[0] for call in cur.execute.call_args_list)


def test_pg_eviction_only_removes_owners_oldest_rows_and_invalidation_is_scoped():
    cache, cur, _, _ = mock_pg()
    cur.fetchall.return_value = [(A, None), (B, None)]
    assert cache.put("alice", C, "third", 60)
    evict = [call.args for call in cur.execute.call_args_list if "AND cache_key=%s" in call.args[0]]
    assert evict == [("DELETE FROM ai_response_cache WHERE user_id=%s AND cache_key=%s", ("alice", A))]
    cache.invalidate_user("alice")
    assert cur.execute.call_args.args == ("DELETE FROM ai_response_cache WHERE user_id=%s", ("alice",))
    cache.invalidate_document("alice", "doc")
    assert cur.execute.call_args.args == (
        "DELETE FROM ai_response_cache WHERE user_id=%s AND document_id=%s",
        ("alice", "doc"),
    )


def test_pg_scope_collision_cannot_evict_or_replace_a_live_entry():
    cache, cur, _, _ = mock_pg(rows=[("alice",), ("doc-b",)])
    cur.fetchall.return_value = [(A, "doc-a"), (B, "doc-a")]
    assert not cache.put("alice", A, "wrong document", 60, "doc-b")
    queries = [call.args[0] for call in cur.execute.call_args_list]
    assert not any("INSERT" in sql or "AND cache_key=%s" in sql for sql in queries)


def test_pg_lowered_entry_limit_applies_even_when_updating_existing_key():
    cache, cur, _, _ = mock_pg()
    cache.max_entries_per_user = 1
    cur.fetchall.return_value = [(A, None), (B, None), (C, None)]
    assert cache.put("alice", C, "updated", 60)
    evictions = [call.args[1] for call in cur.execute.call_args_list if "AND cache_key=%s" in call.args[0]]
    assert evictions == [("alice", A), ("alice", B)]


def test_pg_bad_table_name_or_backend_failure_cannot_silently_fallback():
    with pytest.raises(ValueError):
        PgResponseCache("unused", table="cache;DROP TABLE users", max_content_chars=10, max_entries_per_user=1)
    cache, _, _, connect = mock_pg()
    connect.side_effect = ConnectionError("offline")
    with pytest.raises(ConnectionError):
        cache.get("alice", A)
