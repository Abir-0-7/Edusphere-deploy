"""Owner-scoped lightweight reads and nonblocking document processing repairs."""

import asyncio
import io
import json
import os
import threading
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

import app.main as main
from app.documents.pg_store import PgDocumentStore
from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.errors import InvalidInput
from app.llm.admission import ai_scope, current_ai_owner


def structured_store():
    store = InMemoryDocumentStore()
    doc = store.create(user_id="owner", filename="source.pdf", mime_type="application/pdf", size_bytes=1)
    chapter = ChapterRecord("chapter", doc.id, "owner", "Chapter", 1, 1, 2)
    chunk = ChunkRecord("chunk", doc.id, "owner", chapter.id, "Source content", 1, 1)
    store.replace_structure(doc.id, [chapter], [chunk])
    return store, doc, chapter


def test_memory_chapter_reads_distinguish_empty_missing_and_foreign_documents():
    store, doc, chapter = structured_store()
    assert store.list_chapters_for_user(doc.id, "other") is None
    assert store.list_chapters_for_user("missing", "owner") is None
    result = store.list_chapters_for_user(doc.id, "owner")
    assert result == [chapter]
    result.clear()
    assert store.list_chapters_for_user(doc.id, "owner") == [chapter]
    empty = store.create(user_id="owner", filename="empty.pdf", mime_type="application/pdf", size_bytes=0)
    assert store.list_chapters_for_user(empty.id, "owner") == []


def test_memory_saved_summary_enforces_owner_and_current_chapter_membership():
    store, doc, chapter = structured_store()
    saved = store.upsert_summary(
        chapter_id=chapter.id, user_id="owner", level="standard", content="Private summary", model=None,
    )
    assert store.get_summary(chapter.id, "standard", "owner") == saved
    assert store.get_summary(chapter.id, "standard", "other") is None
    assert store.get_summary(chapter.id, "eli5", "owner") is None
    store.replace_structure(doc.id, [], [])
    assert store.get_summary(chapter.id, "standard", "owner") is None


@pytest.mark.parametrize("rows, expected", [
    ([], None), ([(None,) * 7], []),
    (
        [("chapter", "document", "owner", "Title", 1, 2, 3)],
        [ChapterRecord("chapter", "document", "owner", "Title", 1, 2, 3)],
    ),
])
def test_pg_lightweight_chapter_read_is_owner_scoped(rows, expected):
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchall.return_value = rows
    store = PgDocumentStore.__new__(PgDocumentStore)
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value = cursor
    store._connect_for_atomic = MagicMock(return_value=connection)

    assert store.list_chapters_for_user("document", "owner") == expected
    query, params = cursor.execute.call_args.args
    assert "LEFT JOIN chapters" in query and "c.user_id=d.user_id" in query
    assert "d.user_id=%s" in query and params == ("document", "owner")
    assert "chunks" not in query and "markdown" not in query


def test_pg_structure_batches_preserve_existing_locks_and_chunk_cap():
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [("owner",), ("owner",), ("document",)]
    batches = []
    cursor.executemany.side_effect = lambda query, values: batches.append((query, list(values)))
    connection = MagicMock()
    connection.cursor.return_value = cursor
    store = PgDocumentStore.__new__(PgDocumentStore)
    store._conn = connection
    store._max_chunks_per_document = 2
    chapter = ChapterRecord("chapter", "document", "owner", "Title", 1, 1, 2)
    chunks = [ChunkRecord(f"chunk-{n}", "document", "owner", chapter.id, f"Text {n}", n, n) for n in (1, 2)]

    store.replace_structure("document", [chapter], chunks)
    queries = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("FOR KEY SHARE" in query for query in queries)
    assert any("FOR UPDATE" in query for query in queries)
    assert not any(query.startswith("INSERT") for query in queries)
    assert len(batches) == 2
    assert "INSERT INTO chapters" in batches[0][0]
    assert batches[0][1] == [("chapter", "document", "owner", "Title", 1, 1, 2)]
    assert "INSERT INTO chunks" in batches[1][0]
    assert batches[1][1] == [
        (chunk.id, chunk.document_id, chunk.user_id, chunk.chapter_id, chunk.content, chunk.page, chunk.ordinal)
        for chunk in chunks
    ]
    connection.transaction.assert_called_once()
    connection.reset_mock()
    with pytest.raises(InvalidInput, match="chunk limit"):
        store.replace_structure("document", [chapter], chunks + chunks)
    connection.transaction.assert_not_called()


def test_read_handlers_use_scoped_store_operations_outside_event_loop(monkeypatch):
    chapter = ChapterRecord("chapter", "document", "reader", "Title", 1, 1, 2)

    class ScopedReads:
        def list_chapters_for_user(self, document_id, user_id):
            with pytest.raises(RuntimeError, match="no running event loop"):
                asyncio.get_running_loop()
            return [chapter] if (document_id, user_id) == ("document", "reader") else None

        def get_summary(self, chapter_id, level, user_id):
            with pytest.raises(RuntimeError, match="no running event loop"):
                asyncio.get_running_loop()
            if (chapter_id, level, user_id) == ("chapter", "standard", "reader"):
                return {"id": "saved", "content": "Saved summary"}
            return None

    monkeypatch.setattr(main, "documents", ScopedReads())
    client = TestClient(main.app)
    owner = {"Authorization": "Bearer reader"}
    foreign = {"Authorization": "Bearer other"}
    chapters = client.get("/api/documents/document/chapters", headers=owner)
    assert chapters.status_code == 200
    assert chapters.json() == [{"id": "chapter", "title": "Title", "ordinal": 1, "start_page": 1, "end_page": 2}]
    assert client.get("/api/documents/document/chapters", headers=foreign).status_code == 404
    saved = client.get("/api/chapters/chapter/summary?level=standard", headers=owner)
    assert saved.status_code == 200 and saved.json()["content"] == "Saved summary"
    assert client.get("/api/chapters/chapter/summary?level=standard", headers=foreign).status_code == 404


@pytest.mark.asyncio
async def test_upload_validates_pdf_outside_event_loop_with_existing_limits(monkeypatch):
    loop_thread = threading.get_ident()
    seen = []

    def validate(data, filename, content_type, **limits):
        assert threading.get_ident() != loop_thread
        seen.append((data, filename, content_type, limits))

    store = InMemoryDocumentStore()
    monkeypatch.setattr(main, "documents", store)
    monkeypatch.setattr(main, "validate_pdf", validate)
    monkeypatch.setattr(main, "enqueue", lambda kind, payload: "job")
    upload = UploadFile(
        io.BytesIO(b"%PDF sample"), filename="source.pdf", headers=Headers({"content-type": "application/pdf"}),
    )
    result = await main.parse_pdf_endpoint(upload, "owner")
    assert result["job_id"] == "job"
    assert seen == [(b"%PDF sample", "source.pdf", "application/pdf", {
        "max_mb": main.settings.max_upload_mb, "max_pages": main.settings.max_pages,
    })]
    assert store.read_source_bytes(result["document_id"], "owner") == b"%PDF sample"


@pytest.mark.asyncio
async def test_first_summary_token_offloads_provider_and_preserves_request_owner(monkeypatch):
    store, _doc, chapter = structured_store()
    loop_thread = threading.get_ident()

    def summary(*args):
        assert threading.get_ident() != loop_thread
        assert current_ai_owner() == "owner"
        yield "First "
        yield "second"

    monkeypatch.setattr(main, "documents", store)
    monkeypatch.setattr(main, "stream_summary", summary)
    with ai_scope("owner"):
        response = await main.stream_chapter_summary(chapter.id, {"level": "standard"}, "owner")
        events = [json.loads(event.removeprefix("data: ")) async for event in response.body_iterator]
    assert [event["token"] for event in events if "token" in event] == ["First ", "second"]
    assert events[-1]["done"] is True
    assert store.get_summary(chapter.id, "standard", "owner")["content"] == "First second"


@pytest.mark.asyncio
async def test_failed_first_summary_token_does_not_save_partial_result(monkeypatch):
    store, _doc, chapter = structured_store()

    def fail(*args):
        raise ConnectionError("provider unavailable")
        yield  # pragma: no cover - keep the provider surface a lazy iterator

    monkeypatch.setattr(main, "documents", store)
    monkeypatch.setattr(main, "stream_summary", fail)
    response = await main.stream_chapter_summary(chapter.id, {"level": "standard"}, "owner")
    events = [json.loads(event.removeprefix("data: ")) async for event in response.body_iterator]
    assert events == [{"error": "ConnectionError"}]
    assert store.get_summary(chapter.id, "standard", "owner") is None


def test_pg_structure_failure_rolls_back_and_chapter_reads_hide_partial_publication():
    url = os.getenv("STUDYVAULT_DOCUMENT_REPAIRS_TEST_DATABASE_URL")
    if not url:
        pytest.skip("A disposable document-repairs Postgres URL is not configured")
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import make_conninfo

    schema = f"document_repairs_{uuid4().hex}"
    scoped = make_conninfo(url, options=f"-c search_path={schema},public")
    owner, document_id, old_chapter, old_chunk = [str(uuid4()) for _ in range(4)]
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    store = None
    try:
        with psycopg.connect(scoped, autocommit=True) as conn:
            conn.execute("CREATE TABLE users(id uuid PRIMARY KEY)")
            conn.execute("CREATE TABLE documents(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id))")
            conn.execute(
                "CREATE TABLE chapters(id uuid PRIMARY KEY,document_id uuid REFERENCES documents(id),"
                "user_id uuid REFERENCES users(id),title text,ordinal integer,start_page integer,end_page integer)"
            )
            conn.execute(
                "CREATE TABLE chunks(id uuid PRIMARY KEY,document_id uuid REFERENCES documents(id),"
                "user_id uuid REFERENCES users(id),chapter_id uuid REFERENCES chapters(id),"
                "content text,page integer,ordinal integer)"
            )
            conn.execute("INSERT INTO users VALUES (%s)", (owner,))
            conn.execute("INSERT INTO documents VALUES (%s,%s)", (document_id, owner))
        store = PgDocumentStore(scoped)
        original = ChapterRecord(old_chapter, document_id, owner, "Committed chapter", 1, 1, 1)
        chunk = ChunkRecord(old_chunk, document_id, owner, old_chapter, "Committed source", 1, 1)
        store.replace_structure(document_id, [original], [chunk])
        replacement = ChapterRecord(str(uuid4()), document_id, owner, "Replacement", 1, 1, 1)
        invalid = ChunkRecord(str(uuid4()), document_id, owner, str(uuid4()), "Bad reference", 1, 1)
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            store.replace_structure(document_id, [replacement], [invalid])
        assert store.list_chapters_for_user(document_id, owner) == [original]
        assert store.list_chapters_for_user(document_id, str(uuid4())) is None
        with store._conn.cursor() as cursor:
            cursor.execute("SELECT id,content FROM chunks WHERE document_id=%s", (document_id,))
            assert [(str(row[0]), row[1]) for row in cursor.fetchall()] == [(old_chunk, "Committed source")]
        with store._conn.transaction():
            store._conn.execute("DELETE FROM chunks WHERE document_id=%s", (document_id,))
            store._conn.execute("DELETE FROM chapters WHERE document_id=%s", (document_id,))
            assert store.list_chapters_for_user(document_id, owner) == [original]
    finally:
        if store is not None:
            store._conn.close()
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
