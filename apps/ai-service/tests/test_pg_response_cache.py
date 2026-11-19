"""Optional cache integration tests on isolated tables in a disposable database."""

import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest

from app.llm.response_cache import PgResponseCache

URL = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="STUDYVAULT_TEST_DATABASE_URL not set")


@pytest.fixture()
def setup():
    import psycopg

    suffix = uuid.uuid4().hex[:10]
    owner_table, document_table, table = (f"cache_{kind}_{suffix}" for kind in ("owners", "docs", "responses"))
    owner, other, doc, other_doc = (str(uuid.uuid4()) for _ in range(4))
    clock = [datetime.now(UTC)]
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute(f"CREATE TABLE {owner_table} (id uuid PRIMARY KEY)")
        conn.execute(f"INSERT INTO {owner_table} VALUES (%s),(%s)", (owner, other))
        conn.execute(
            f"CREATE TABLE {document_table} (id uuid PRIMARY KEY, user_id uuid NOT NULL "
            f"REFERENCES {owner_table}(id) ON DELETE CASCADE)"
        )
        conn.execute(f"INSERT INTO {document_table} VALUES (%s,%s),(%s,%s)", (doc, owner, other_doc, other))
        conn.execute(
            f"CREATE TABLE {table} (user_id uuid NOT NULL REFERENCES {owner_table}(id) ON DELETE CASCADE,"
            f" document_id uuid REFERENCES {document_table}(id) ON DELETE CASCADE, cache_key varchar(64) NOT NULL,"
            " content text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL,"
            " updated_at timestamptz NOT NULL, UNIQUE(user_id,cache_key))"
        )
    cache = PgResponseCache(
        URL,
        max_content_chars=100,
        max_entries_per_user=3,
        clock=lambda: clock[0],
        table=table,
        owner_table=owner_table,
        document_table=document_table,
    )
    try:
        yield cache, clock, owner, other, doc, other_doc
    finally:
        with psycopg.connect(URL, autocommit=True) as conn:
            conn.execute(f"DROP TABLE IF EXISTS {table}")
            conn.execute(f"DROP TABLE IF EXISTS {document_table}")
            conn.execute(f"DROP TABLE IF EXISTS {owner_table}")


def test_pg_expiry_ownership_document_and_account_deletion(setup):
    import psycopg

    cache, clock, owner, other, doc, other_doc = setup
    key = "a" * 64
    assert cache.put(owner, key, "answer", 60, doc)
    assert cache.get(owner, key, doc) == "answer"
    assert cache.get(other, key, doc) is None
    assert cache.get(owner, key, other_doc) is None
    assert not cache.put(owner, "b" * 64, "wrong owner", 60, other_doc)
    clock[0] += timedelta(seconds=60)
    assert cache.get(owner, key, doc) is None
    assert cache.put(owner, key, "refreshed", 60, doc)
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute(f"DELETE FROM {cache.document_table} WHERE id=%s", (doc,))
        assert conn.execute(f"SELECT count(*) FROM {cache.table} WHERE user_id=%s", (owner,)).fetchone()[0] == 0
    assert cache.get(owner, key, doc) is None
    assert not cache.put(owner, key, "late response", 60, doc)
    assert cache.put(owner, key, "source-less", 60)
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute(f"DELETE FROM {cache.owner_table} WHERE id=%s", (owner,))
        assert conn.execute(f"SELECT count(*) FROM {cache.table} WHERE user_id=%s", (owner,)).fetchone()[0] == 0
    assert not cache.put(owner, key, "late response", 60)


def test_pg_concurrent_writes_remain_bounded_and_rehydrate_across_instances(setup):
    import psycopg

    cache, clock, owner, _, doc, _ = setup
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert all(pool.map(lambda n: cache.put(owner, f"{n:064x}", str(n), 60, doc), range(16)))
    with psycopg.connect(URL) as conn:
        rows = conn.execute(f"SELECT cache_key, content FROM {cache.table} WHERE user_id=%s", (owner,)).fetchall()
    assert len(rows) == 3
    reloaded = PgResponseCache(
        URL,
        max_content_chars=100,
        max_entries_per_user=3,
        clock=lambda: clock[0],
        table=cache.table,
        owner_table=cache.owner_table,
        document_table=cache.document_table,
    )
    for key, content in rows:
        assert reloaded.get(owner, key, doc) == content
