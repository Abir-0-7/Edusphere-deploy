"""F01 migration acceptance in a temporary schema on disposable PostgreSQL.

Set STUDYVAULT_SOURCE_TEST_DATABASE_URL (or STUDYVAULT_TEST_DATABASE_URL).
Only the generated schema is removed; existing application tables are untouched.
"""

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb

from app.documents.store import ChapterRecord, ChunkRecord, DocumentRecord
from app.errors import Conflict, InvalidInput, NotFound
from app.source_versions.contracts import EvidencePin, PdfSnapshotRequest, SourceSnapshot
from app.source_versions.service import pdf_snapshot
from app.source_versions.store import PgSourceVersionStore


@pytest.fixture()
def source_database():
    url = os.getenv("STUDYVAULT_SOURCE_TEST_DATABASE_URL") or os.getenv("STUDYVAULT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("A disposable source-version Postgres URL is not configured")
    schema = f"source_f01_{uuid4().hex}"
    scoped_url = make_conninfo(url, options=f"-c search_path={schema},public")
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    try:
        with psycopg.connect(scoped_url, autocommit=True) as conn:
            conn.execute("CREATE TABLE users (id uuid PRIMARY KEY, clerk_id text, email text)")
            conn.execute(
                "CREATE TABLE documents (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) "
                "ON DELETE CASCADE, filename text NOT NULL, mime_type text NOT NULL, size_bytes integer NOT NULL, "
                "page_count integer, status text NOT NULL DEFAULT 'parsed', markdown text, error_reason text, "
                "UNIQUE(id,user_id))"
            )
            conn.execute(
                "CREATE TABLE chapters (id uuid PRIMARY KEY, document_id uuid REFERENCES documents(id) "
                "ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "title text, ordinal integer, start_page integer, end_page integer)"
            )
            conn.execute(
                "CREATE TABLE chunks (id uuid PRIMARY KEY, document_id uuid REFERENCES documents(id) "
                "ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
                "chapter_id uuid REFERENCES chapters(id) ON DELETE CASCADE, content text NOT NULL, "
                "page integer, ordinal integer)"
            )
            migration = Path(__file__).resolve().parents[3] / "packages/db/drizzle/0018_source_versions.sql"
            for statement in migration.read_text(encoding="utf-8").split("--> statement-breakpoint"):
                if statement.strip():
                    conn.execute(statement)
        yield scoped_url
    finally:
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def _parents(conn):
    owner, other, document = (uuid4() for _ in range(3))
    conn.execute("INSERT INTO users (id) VALUES (%s),(%s)", (owner, other))
    conn.execute(
        "INSERT INTO documents (id,user_id,filename,mime_type,size_bytes,page_count) "
        "VALUES (%s,%s,'legacy.pdf','application/pdf',10,3)",
        (document, owner),
    )
    return owner, other, document


def _insert(conn, owner, document=None, content_hash="a" * 64, snapshot=None):
    return conn.execute(
        "INSERT INTO source_versions (user_id,document_id,content_hash,snapshot) VALUES (%s,%s,%s,%s) RETURNING id",
        (owner, document, content_hash, Jsonb({"format_version": 1} if snapshot is None else snapshot)),
    ).fetchone()[0]


def test_source_version_migration_scopes_ownership_and_deduplicates_per_account(source_database):
    with psycopg.connect(source_database, autocommit=True) as conn:
        owner, other, document = _parents(conn)
        version = _insert(conn, owner, document)
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            _insert(conn, other, document, "b" * 64)
        with pytest.raises(psycopg.errors.UniqueViolation):
            _insert(conn, owner, document)
        # An equal hash in another account does not share the private row.
        other_version = _insert(conn, other)
        assert other_version != version
        row = conn.execute(
            "SELECT user_id,document_id,created_at,updated_at FROM source_versions WHERE id=%s", (version,)
        ).fetchone()
        assert row[0:2] == (owner, document) and row[2] == row[3]


def test_source_version_migration_rejects_mutation_and_invalid_payloads(source_database):
    with psycopg.connect(source_database, autocommit=True) as conn:
        owner, other, document = _parents(conn)
        version = _insert(conn, owner, document)
        for expression, value in (
            ("user_id=%s", other),
            ("document_id=%s", None),
            ("content_hash=%s", "b" * 64),
            ("snapshot=%s", Jsonb({"changed": True})),
            ("created_at=%s", "2020-01-01T00:00:00Z"),
            ("updated_at=%s", "2020-01-01T00:00:00Z"),
        ):
            with pytest.raises(psycopg.errors.CheckViolation, match="immutable"):
                conn.execute(f"UPDATE source_versions SET {expression} WHERE id=%s", (value, version))
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert(conn, owner, content_hash="not-a-sha256")
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert(conn, owner, content_hash="b" * 64, snapshot=[])
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert(conn, owner, content_hash="c" * 64, snapshot={"text": "x" * 3145728})
        assert conn.execute("SELECT content_hash FROM source_versions WHERE id=%s", (version,)).fetchone() == (
            "a" * 64,
        )


def test_source_version_migration_cascades_source_and_account_without_changing_legacy(source_database):
    with psycopg.connect(source_database, autocommit=True) as conn:
        owner, other, document = _parents(conn)
        _insert(conn, owner, document)
        repo_version = _insert(conn, owner, content_hash="b" * 64)
        other_version = _insert(conn, other)
        # The additive migration has not rewritten the document or its study identity.
        assert conn.execute("SELECT filename,page_count FROM documents WHERE id=%s", (document,)).fetchone() == (
            "legacy.pdf", 3,
        )
        conn.execute("DELETE FROM documents WHERE id=%s AND user_id=%s", (document, owner))
        assert conn.execute("SELECT id FROM source_versions WHERE user_id=%s", (owner,)).fetchall() == [(repo_version,)]
        conn.execute("DELETE FROM users WHERE id=%s", (owner,))
        assert conn.execute("SELECT id FROM source_versions").fetchall() == [(other_version,)]


def _pdf(conn):
    owner, other, document_id = _parents(conn)
    chapter_id, chunk_id = uuid4(), uuid4()
    conn.execute(
        "INSERT INTO chapters (id,document_id,user_id,title,ordinal,start_page,end_page) "
        "VALUES (%s,%s,%s,'Chapter',0,2,2)", (chapter_id, document_id, owner),
    )
    conn.execute(
        "INSERT INTO chunks (id,document_id,user_id,chapter_id,content,page,ordinal) "
        "VALUES (%s,%s,%s,%s,'Exact authorized passage.',2,0)", (chunk_id, document_id, owner, chapter_id),
    )
    document = DocumentRecord(
        str(document_id), str(owner), "legacy.pdf", "application/pdf", 10, page_count=3, status="parsed",
        chapters=[ChapterRecord(str(chapter_id), str(document_id), str(owner), "Chapter", 0, 2, 2)],
        chunks=[ChunkRecord(
            str(chunk_id), str(document_id), str(owner), str(chapter_id), "Exact authorized passage.", 2, 0,
        )],
    )
    return str(owner), str(other), document


def test_course_pin_resolution_holds_parent_and_version_until_transaction_ends(source_database):
    with psycopg.connect(source_database, autocommit=True) as conn:
        owner, _, document = _pdf(conn)
        store = PgSourceVersionStore(source_database)
        version = store.save(owner, pdf_snapshot(document, PdfSnapshotRequest()))
        segment = version.snapshot.segments[0]
        pin = EvidencePin(
            version_id=version.id, content_hash=version.content_hash,
            segment_id=segment.id, locator=segment.locator, quote=segment.text,
        )
        with conn.transaction():
            assert store.resolve(owner, pin, conn=conn).content == segment.text
            with psycopg.connect(source_database, autocommit=True) as deleting:
                deleting.execute("SET lock_timeout='100ms'")
                with pytest.raises(psycopg.errors.LockNotAvailable):
                    deleting.execute("DELETE FROM documents WHERE id=%s AND user_id=%s", (document.id, owner))
        conn.execute("DELETE FROM documents WHERE id=%s AND user_id=%s", (document.id, owner))
        assert store.get(owner, str(version.id)) is None
        with conn.transaction(), pytest.raises(NotFound):
            store.resolve(owner, pin, conn=conn)


def _repository(title):
    text = "selected line one\nselected line two"
    return SourceSnapshot.model_validate({
        "title": title,
        "origin": {"kind": "github", "owner": "example", "repository": "book", "commit": "a" * 40},
        "provenance": {
            "adapter": "github_selected_text", "parser_name": "fixture", "parser_version": "1",
            "rights": {"status": "unknown"},
        },
        "segments": [{
            "id": "readme", "locator": {"kind": "github", "path": "docs/intro.md", "start_line": 3, "end_line": 4},
            "text": text, "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
        }],
    })


def test_pg_source_store_freezes_precise_pdf_evidence_and_revalidates_writes(source_database):
    with psycopg.connect(source_database, autocommit=True) as conn:
        owner, other, document = _pdf(conn)
        snapshot = pdf_snapshot(document, PdfSnapshotRequest(edition="Second", printed_page_labels={"2": "iv"}))
        store = PgSourceVersionStore(source_database, max_versions_per_user=2)
        first = store.save(owner, snapshot)
        assert store.save(owner, snapshot) == first
        assert PgSourceVersionStore(source_database).get(owner, str(first.id)) == first
        assert store.get(other, str(first.id)) is None
        pin = EvidencePin(
            version_id=first.id, content_hash=first.content_hash, segment_id=snapshot.segments[0].id,
            locator=snapshot.segments[0].locator, quote="authorized passage",
        )
        assert store.resolve(owner, pin).content == "Exact authorized passage."
        with pytest.raises(NotFound):
            store.resolve(other, pin)
        with pytest.raises(NotFound):
            store.save(other, snapshot)

        conn.execute("UPDATE chunks SET content='Replacement extraction.' WHERE document_id=%s", (document.id,))
        with pytest.raises(Conflict, match="source changed"):
            store.save(owner, snapshot)
        # Older links remain pinned to their immutable text; current extraction cannot rewrite them.
        assert store.resolve(owner, pin).content == "Exact authorized passage."
        document.chunks[0].content = "Replacement extraction."
        updated = pdf_snapshot(document, PdfSnapshotRequest())
        second = store.save(owner, updated)
        assert second.id != first.id and second.content_hash != first.content_hash
        with pytest.raises(InvalidInput, match="limit reached"):
            store.save(owner, pdf_snapshot(document, PdfSnapshotRequest(edition="Third")))
        assert conn.execute("SELECT count(*) FROM source_versions WHERE user_id=%s", (owner,)).fetchone() == (2,)
        conn.execute("DELETE FROM documents WHERE id=%s AND user_id=%s", (document.id, owner))
        assert store.get(owner, str(first.id)) is None and store.get(owner, str(second.id)) is None
        with pytest.raises(NotFound):
            store.save(owner, updated)
        assert conn.execute("SELECT count(*) FROM source_versions WHERE user_id=%s", (owner,)).fetchone() == (0,)


def test_pg_source_store_serializes_replays_and_caps_then_does_not_recreate_deleted_owner(source_database):
    with psycopg.connect(source_database, autocommit=True) as conn:
        owner, other, _ = _parents(conn)
    owner, other = str(owner), str(other)
    store = PgSourceVersionStore(source_database, max_versions_per_user=1)
    snapshot = _repository("Pinned repository fixture")
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: store.save(owner, snapshot), range(8)))
    assert len({record.id for record in results}) == 1
    with psycopg.connect(source_database, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM source_versions WHERE user_id=%s", (owner,)).fetchone() == (1,)

    def competing_save(index):
        try:
            return store.save(other, _repository(f"Concurrent fixture {index}"))
        except InvalidInput:
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        competitors = list(pool.map(competing_save, range(8)))
    assert sum(item is not None for item in competitors) == 1
    with psycopg.connect(source_database, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM source_versions WHERE user_id=%s", (other,)).fetchone() == (1,)
        conn.execute("DELETE FROM users WHERE id=%s", (owner,))
    assert store.get(owner, str(results[0].id)) is None
    with pytest.raises(NotFound):
        store.save(owner, snapshot)
