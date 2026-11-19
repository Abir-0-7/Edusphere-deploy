"""Optional real atomic UPDATE race, isolated to a unique disposable test table."""

import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest

from app.llm.admission import PgDailyQuota

URL = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="STUDYVAULT_TEST_DATABASE_URL not set")


def test_pg_concurrent_quota_reservations_stop_at_cap():
    import psycopg

    table = f"quota_test_{uuid.uuid4().hex[:10]}"
    owner = str(uuid.uuid4())
    try:
        with psycopg.connect(URL, autocommit=True) as conn:
            conn.execute(
                f"CREATE TABLE {table} (id uuid PRIMARY KEY, daily_ai_quota_used integer NOT NULL DEFAULT 0,"
                " quota_reset_date text, updated_at timestamptz DEFAULT now())"
            )
            conn.execute(f"INSERT INTO {table} (id) VALUES (%s)", (owner,))
        quota = PgDailyQuota(URL, table=table)
        now = datetime.now(UTC)
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: quota.reserve(owner, 3, now), range(16)))
        assert sum(results) == 3
        with psycopg.connect(URL) as conn:
            assert conn.execute(f"SELECT daily_ai_quota_used FROM {table}").fetchone()[0] == 3
    finally:
        with psycopg.connect(URL, autocommit=True) as conn:
            conn.execute(f"DROP TABLE IF EXISTS {table}")
