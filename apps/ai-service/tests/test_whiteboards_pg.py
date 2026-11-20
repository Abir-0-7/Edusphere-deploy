"""E07 acceptance against migration 0022 in a disposable PostgreSQL schema.

Set STUDYVAULT_WHITEBOARD_TEST_DATABASE_URL (or STUDYVAULT_TEST_DATABASE_URL).
No application schema is migrated; the generated schema is removed afterward.
"""

import base64
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo
from pydantic import ValidationError

from app.errors import Conflict
from app.whiteboards.contracts import WhiteboardScene
from app.whiteboards.store import PgWhiteboardStore

PNG = b"\x89PNG\r\n\x1a\nowned image"


@pytest.fixture()
def whiteboard_database():
    url = os.getenv("STUDYVAULT_WHITEBOARD_TEST_DATABASE_URL") or os.getenv("STUDYVAULT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("A disposable whiteboard Postgres URL is not configured")
    schema = f"whiteboard_e07_{uuid4().hex}"
    scoped = make_conninfo(url, options=f"-c search_path={schema},public")
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    try:
        with psycopg.connect(scoped, autocommit=True) as conn:
            conn.execute(
                "CREATE TABLE users (id uuid PRIMARY KEY, clerk_id text, email text, "
                "created_at timestamptz DEFAULT now())"
            )
            migration = Path(__file__).resolve().parents[3] / "packages/db/drizzle/0022_whiteboards.sql"
            for statement in migration.read_text(encoding="utf-8").split("--> statement-breakpoint"):
                if statement.strip():
                    conn.execute(statement.replace('"public".', ''))
        yield scoped
    finally:
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def parents(url):
    owner, other = str(uuid4()), str(uuid4())
    with psycopg.connect(url) as conn:
        conn.execute("INSERT INTO users(id,clerk_id) VALUES (%s,'first'),(%s,'other')", (owner, other))
    return owner, other


def scene(*, text="", file_id=None):
    elements = [{"id": "note", "type": "text", "text": text}] if text else []
    if file_id:
        elements.append({"id": "image", "type": "image", "fileId": file_id})
    return WhiteboardScene(elements=elements, app_state={}, file_ids=[file_id] if file_id else [])


def test_migration_restart_ownership_assets_and_cascades(whiteboard_database):
    owner, other = parents(whiteboard_database)
    store = PgWhiteboardStore(whiteboard_database)
    board = store.create_board(owner, "Owned study", scene(text="Original note"))
    other_board = store.create_board(other, "Other private board", scene())
    image = store.create_asset(owner, board.board_id, "owned-image", "image/png", PNG)
    assert image is not None
    assert store.create_asset(owner, board.board_id, "owned-image", "image/png", PNG) == image
    saved = store.update_board(
        owner, board.board_id, "Named project", scene(file_id="owned-image"), expected_revision=1,
    )

    restarted = PgWhiteboardStore(whiteboard_database)
    assert restarted.get_board(owner, board.board_id) == saved
    assert restarted.get_asset(owner, board.board_id, image.id).data == PNG
    assert restarted.get_board(other, board.board_id) is None
    assert restarted.get_asset(other, board.board_id, image.id) is None
    assert restarted.list_assets(other, board.board_id) is None
    assert restarted.create_asset(other, board.board_id, "intruder", "image/png", PNG) is None
    assert restarted.update_board(other, board.board_id, "Stolen", scene(), expected_revision=2) is None
    assert not restarted.delete_board(other, board.board_id)
    with psycopg.connect(whiteboard_database, autocommit=True) as conn:
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            conn.execute(
                "INSERT INTO whiteboard_assets(id,user_id,board_id,file_id,mime_type,size_bytes,sha256,data) "
                "VALUES (%s,%s,%s,'cross-owner','image/png',%s,%s,%s)",
                (uuid4(), other, board.board_id, len(PNG), image.sha256, PNG),
            )
        conn.execute("DELETE FROM users WHERE id=%s", (owner,))
        assert conn.execute("SELECT count(*) FROM whiteboard_assets").fetchone() == (0,)
    assert restarted.get_board(owner, board.board_id) is None
    assert restarted.get_board(other, other_board.board_id) is not None


def test_two_tabs_cas_one_commit_and_asset_content_cannot_be_replaced(whiteboard_database):
    owner, _ = parents(whiteboard_database)
    store = PgWhiteboardStore(whiteboard_database)
    board = store.create_board(owner, "Board", scene())
    asset = store.create_asset(owner, board.board_id, "picture", "image/png", PNG)
    with pytest.raises(Conflict, match="immutable"):
        store.create_asset(owner, board.board_id, "picture", "image/png", PNG + b"changed")
    assert store.get_asset(owner, board.board_id, asset.id).data == PNG
    barrier = Barrier(2)

    def save(title):
        barrier.wait(timeout=5)
        try:
            return PgWhiteboardStore(whiteboard_database).update_board(
                owner, board.board_id, title, scene(file_id="picture"), expected_revision=1,
            )
        except Conflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(save, ["First tab", "Second tab"]))
    assert outcomes.count("conflict") == 1
    saved = store.get_board(owner, board.board_id)
    assert saved.revision == 2 and saved.title in {"First tab", "Second tab"}
    with pytest.raises(Conflict, match="Remove this image"):
        store.delete_asset(owner, board.board_id, asset.id)
    assert store.delete_board(owner, board.board_id)
    assert store.get_asset(owner, board.board_id, asset.id) is None


def test_account_cap_race_and_pagination_are_owner_scoped(whiteboard_database):
    owner, other = parents(whiteboard_database)
    barrier = Barrier(2)

    def create(title):
        barrier.wait(timeout=5)
        try:
            return PgWhiteboardStore(whiteboard_database, max_boards_per_user=1).create_board(owner, title, scene())
        except ValueError as error:
            return str(error)

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(create, ["First", "Second"]))
    assert sum(isinstance(value, str) and "limit reached" in value for value in outcomes) == 1
    store = PgWhiteboardStore(whiteboard_database)
    store.create_board(other, "Private", scene())
    page, total = store.list_boards(owner, limit=1, offset=0)
    assert len(page) == total == 1
    assert store.list_boards(owner, limit=1, offset=1) == ([], 1)


def test_failed_snapshot_envelope_rolls_back_create_and_update(whiteboard_database, monkeypatch):
    import app.whiteboards.contracts as contracts

    owner, _ = parents(whiteboard_database)
    store = PgWhiteboardStore(whiteboard_database)
    board = store.create_board(owner, "Original", scene())
    monkeypatch.setattr(contracts, "MAX_SNAPSHOT_BYTES", 500)
    oversized = scene(text="x" * 500)
    with pytest.raises(ValidationError, match="limited to 5 MiB"):
        store.create_board(owner, "Invalid create", oversized)
    with pytest.raises(ValidationError, match="limited to 5 MiB"):
        store.update_board(owner, board.board_id, "Invalid update", oversized, expected_revision=1)
    assert store.get_board(owner, board.board_id) == board
    assert store.list_boards(owner, limit=10, offset=0)[1] == 1


def test_existing_privacy_export_serializes_only_owned_board_and_image(whiteboard_database, monkeypatch):
    # Other privacy tables have their own migration tests; use their empty
    # relation shapes here so this check executes the real export/cascade path.
    import app.privacy as privacy

    owner, other = parents(whiteboard_database)
    store = PgWhiteboardStore(whiteboard_database)
    board = store.create_board(owner, "My exported project", scene())
    image = store.create_asset(owner, board.board_id, "mine", "image/png", PNG)
    other_board = store.create_board(other, "Other person's project", scene())
    store.create_asset(other, other_board.board_id, "theirs", "image/png", PNG + b"other")
    with psycopg.connect(whiteboard_database) as conn:
        conn.execute(
            "CREATE TABLE realtime_duels (id uuid,user_id uuid,opponent_user_id uuid,state jsonb,"
            "created_at timestamptz,updated_at timestamptz,expires_at timestamptz)"
        )
        conn.execute(
            "CREATE TABLE jobs (id uuid,kind text,payload jsonb,status text,attempts integer,"
            "run_after timestamptz,created_at timestamptz,updated_at timestamptz)"
        )
    monkeypatch.setattr(privacy, "_OWNED_TABLES", [
        entry for entry in privacy._OWNED_TABLES if entry[0] in {"whiteboards", "whiteboard_assets"}
    ])
    monkeypatch.setattr(privacy, "_GUILD_TABLES", [])
    exporter = privacy.PrivacyStore(whiteboard_database)
    try:
        result = exporter.export_user_data(owner)
        assert [row["id"] for row in result["tables"]["whiteboards"]] == [str(board.board_id)]
        assert [row["id"] for row in result["tables"]["whiteboard_assets"]] == [str(image.id)]
        exported = result["tables"]["whiteboard_assets"][0]["data"]
        assert exported["encoding"] == "base64" and base64.b64decode(exported["value"]) == PNG
        assert exporter.delete_user_data(owner) == 1
        assert store.get_asset(owner, board.board_id, image.id) is None
        assert store.get_board(other, other_board.board_id) is not None
    finally:
        exporter.close()
