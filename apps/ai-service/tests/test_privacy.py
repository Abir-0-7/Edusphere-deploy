"""Tests for data export and deletion (task 7.4)."""

import os
from unittest.mock import MagicMock

import pytest
import pytest as _pytest

URL = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")


@pytest.fixture()
def privacy():
    pytest.importorskip("psycopg")
    import uuid

    from app.documents.pg_store import PgDocumentStore
    from app.privacy import PrivacyStore

    store = PrivacyStore(URL)
    docs = PgDocumentStore(URL)
    uid = docs.resolve_user(f"privacy-test-{uuid.uuid4().hex[:8]}")
    yield store, docs, uid
    try:
        store.delete_user_data(uid)
    finally:
        store.close()


def _jsonable(value: object) -> bool:
    import json

    try:
        json.dumps(value)
        return True
    except (TypeError, ValueError):
        return False


def test_export_queries_guilds_by_owner_or_membership() -> None:
    from app.privacy import PrivacyStore

    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    connection = MagicMock()
    connection.cursor.return_value = cursor
    cursor.fetchone.return_value = ("user-id", "clerk-id", "person@example.test", "2026-01-01")
    cursor.fetchall.return_value = []

    store = PrivacyStore.__new__(PrivacyStore)
    store._conn = connection
    data = store.export_user_data("user-id")

    guild_query = next(
        query
        for query in cursor.execute.call_args_list
        if "FROM study_guilds WHERE" in query.args[0]
    )
    member_query = next(
        query
        for query in cursor.execute.call_args_list
        if "SELECT id, guild_id, user_id, joined_at FROM study_guild_members WHERE" in query.args[0]
    )
    assert "owner_user_id = %s OR id IN" in guild_query.args[0]
    assert guild_query.args[1] == ("user-id", "user-id")
    assert member_query.args[1] == ("user-id",)
    assert data["tables"]["study_guilds"] == []
    assert data["tables"]["study_guild_members"] == []


@_pytest.mark.skipif(not URL, reason="STUDYVAULT_TEST_DATABASE_URL not set")
def test_export_is_json_serialisable_and_scoped(privacy) -> None:
    import uuid

    store, docs, uid = privacy
    other = docs.resolve_user(f"privacy-other-{uuid.uuid4().hex}")
    assert store.export_user_data(uid) is not None

    # A document for the test user only.
    docs.create(user_id=uid, filename="mine.pdf", mime_type="application/pdf", size_bytes=10)
    docs.create(user_id=other, filename="theirs.pdf", mime_type="application/pdf", size_bytes=10)

    data = store.export_user_data(uid)
    assert data["account"]["email"]
    assert "study_plans" in data["tables"]
    assert "weekly_advice" in data["tables"]
    assert "study_guilds" in data["tables"]
    assert "study_guild_members" in data["tables"]
    filenames = [d["filename"] for d in data["tables"]["documents"]]
    assert "mine.pdf" in filenames
    assert "theirs.pdf" not in filenames
    # Every serialised value must be plain JSON (no uuid/datetime objects).
    assert _jsonable(data)

    # Guild ownership and membership are distinct ownership paths: export both
    # guilds created by this user and memberships in another user's guild.
    owned_guild_id = str(uuid.uuid4())
    joined_guild_id = str(uuid.uuid4())
    unrelated_guild_id = str(uuid.uuid4())
    with docs._conn.cursor() as cur:
        cur.execute(
            "INSERT INTO study_guilds (id, owner_user_id, name, invite_code) VALUES (%s, %s, %s, %s)",
            (owned_guild_id, uid, "Owned guild", f"o-{uuid.uuid4().hex[:10]}"),
        )
        cur.execute(
            "INSERT INTO study_guilds (id, owner_user_id, name, invite_code) VALUES (%s, %s, %s, %s)",
            (joined_guild_id, other, "Joined guild", f"j-{uuid.uuid4().hex[:10]}"),
        )
        cur.execute(
            "INSERT INTO study_guilds (id, owner_user_id, name, invite_code) VALUES (%s, %s, %s, %s)",
            (unrelated_guild_id, other, "Unrelated guild", f"x-{uuid.uuid4().hex[:10]}"),
        )
        cur.execute(
            "INSERT INTO study_guild_members (guild_id, user_id) VALUES (%s, %s)", (joined_guild_id, uid)
        )

    data = store.export_user_data(uid)
    guild_ids = {guild["id"] for guild in data["tables"]["study_guilds"]}
    assert owned_guild_id in guild_ids
    assert joined_guild_id in guild_ids
    assert unrelated_guild_id not in guild_ids
    assert any(row["guild_id"] == joined_guild_id for row in data["tables"]["study_guild_members"])
    store.delete_user_data(other)


@_pytest.mark.skipif(not URL, reason="STUDYVAULT_TEST_DATABASE_URL not set")
def test_delete_removes_owned_rows(privacy) -> None:
    store, docs, uid = privacy
    docs.create(user_id=uid, filename="gone.pdf", mime_type="application/pdf", size_bytes=10)
    assert store.delete_user_data(uid) == 1

    import psycopg as _psycopg

    with _psycopg.connect(URL, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM documents WHERE user_id = %s", (uid,))
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM users WHERE id = %s", (uid,))
        assert cur.fetchone()[0] == 0


def test_game_export_scopes_saves_and_includes_either_duel_member() -> None:
    from app.privacy import PrivacyStore

    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    connection = MagicMock()
    connection.cursor.return_value = cursor
    cursor.fetchone.return_value = ("user-id", "clerk-id", "person@example.test", "2026-01-01")
    cursor.fetchall.return_value = []
    store = PrivacyStore.__new__(PrivacyStore)
    store._conn = connection

    data = store.export_user_data("user-id")

    queries = cursor.execute.call_args_list
    for table in ("game_sessions", "game_mission_progress", "realtime_matchmaking", "realtime_event_limits"):
        query = next(call for call in queries if f"FROM {table} WHERE" in call.args[0])
        assert "WHERE user_id = %s" in query.args[0]
        assert query.args[1] == ("user-id",)
        assert data["tables"][table] == []
    duel = next(call for call in queries if "FROM realtime_duels WHERE" in call.args[0])
    assert "user_id = %s OR opponent_user_id = %s" in duel.args[0]
    assert "state - 'cards'" in duel.args[0]
    assert duel.args[1] == ("user-id", "user-id")
    assert data["tables"]["realtime_duels"] == []
