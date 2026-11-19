"""Optional budget races/restart/cascade integration on disposable isolated tables."""

import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest

from app.errors import RateLimited
from app.llm.budgets import BudgetLimits, PgBudgetStore

URL = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="STUDYVAULT_TEST_DATABASE_URL not set")


@pytest.fixture()
def setup():
    import psycopg

    suffix = uuid.uuid4().hex[:10]
    owner_table, table = f"budget_owners_{suffix}", f"budget_reservations_{suffix}"
    owner, other = (str(uuid.uuid4()) for _ in range(2))
    clock = [datetime.now(UTC)]
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute(f"CREATE TABLE {owner_table} (id uuid PRIMARY KEY)")
        conn.execute(f"INSERT INTO {owner_table} VALUES (%s),(%s)", (owner, other))
        conn.execute(
            f"CREATE TABLE {table} (operation_id uuid PRIMARY KEY,user_id uuid NOT NULL "
            f"REFERENCES {owner_table}(id) ON DELETE CASCADE,feature text NOT NULL,budget_day date NOT NULL,"
            "reserved_tokens integer NOT NULL,actual_tokens integer,state text NOT NULL DEFAULT 'reserved',"
            "expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),"
            "updated_at timestamptz NOT NULL DEFAULT now())"
        )
    store = PgBudgetStore(URL, clock=lambda: clock[0], table=table, owner_table=owner_table)
    try:
        yield store, clock, owner, other
    finally:
        with psycopg.connect(URL, autocommit=True) as conn:
            conn.execute(f"DROP TABLE IF EXISTS {table}")
            conn.execute(f"DROP TABLE IF EXISTS {owner_table}")


def test_pg_global_budget_race_and_restart_settlement_are_atomic(setup):
    import psycopg

    store, clock, owner, other = setup
    caps = BudgetLimits(1000, 500, 1000, 10, 10, 60)

    def reserve(n):
        try:
            return store.reserve(owner if n % 2 else other, str(uuid.uuid4()), "chat", 100, caps)
        except RateLimited:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = [row for row in pool.map(reserve, range(30)) if row]
    assert len(rows) == 5
    reloaded = PgBudgetStore(URL, clock=lambda: clock[0], table=store.table, owner_table=store.owner_table)
    chosen = rows[0]
    with ThreadPoolExecutor(max_workers=8) as pool:
        settled = list(pool.map(lambda _: reloaded.settle(chosen.user_id, chosen.operation_id, 10), range(16)))
    assert sum(settled) == 1
    clock[0] += timedelta(seconds=60)
    # Four expired uncertain calls retain 400; settled call costs 10.
    assert reloaded.reserve(owner, str(uuid.uuid4()), "chat", 90, caps).state == "reserved"
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute(f"DELETE FROM {store.owner_table} WHERE id=%s", (owner,))
        assert conn.execute(f"SELECT COUNT(*) FROM {store.table} WHERE user_id=%s", (owner,)).fetchone()[0] == 0
