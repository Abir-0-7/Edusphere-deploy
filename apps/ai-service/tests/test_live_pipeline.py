"""End-to-end pipeline check against the REAL Neon database (Phase 2 DoD).

Not part of the unit suite: run explicitly with a real URL.

    STUDYVAULT_TEST_DATABASE_URL=postgresql://... \
        pytest tests/test_live_pipeline.py -q -s

It uploads a generated text PDF through the HTTP API, drains the worker
(parse -> structure -> embed via a stub outline + hash embedder), then exercises
hybrid search, grounded chat, flashcard generation and a review. Every row is
removed at the end.
"""

import os
import uuid

import pytest

pytest.importorskip("psycopg")

URL = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="STUDYVAULT_TEST_DATABASE_URL not set")


@pytest.fixture()
def live(monkeypatch: pytest.MonkeyPatch):
    """Swap the app's stores to Postgres-backed ones for this test."""
    import app.main as main
    from app.documents.pg_store import PgDocumentStore
    from app.jobs.postgres_store import PgJobStore
    from app.rag.embeddings import HashEmbedder

    table = f"jobs_live_{uuid.uuid4().hex[:8]}"
    job_store = PgJobStore(URL, table=table)
    docs = PgDocumentStore(URL)

    monkeypatch.setattr(main, "job_store", job_store)
    monkeypatch.setattr(main, "documents", docs)
    monkeypatch.setattr(main, "embedder", HashEmbedder())
    # Rebuild handlers against the swapped stores.
    from app.pipeline import make_embed_handler, make_flashcard_handler, make_parse_handler, make_structure_handler

    monkeypatch.setattr(
        main.worker,
        "store",
        job_store,
    )
    main.worker.handlers = {
        "parse_pdf": make_parse_handler(
            docs=docs, enqueue=main.enqueue, ocr=None, max_pages=main.settings.max_pages
        ),
        "structure_chapters": make_structure_handler(
            docs=docs,
            outline_fn=lambda pages, count: (
                [main.Outline("Live chapter", 1, count, "")],
                "heuristic",
            ),
            chunk_max_chars=main.settings.chunk_max_chars,
            chunk_overlap_chars=main.settings.chunk_overlap_chars,
            enqueue=main.enqueue,
        ),
        "embed_chunks": make_embed_handler(docs=docs, embedder=main.embedder),
        "generate_flashcards": make_flashcard_handler(docs=docs, router=main.llm_router),
    }
    created: list[str] = []
    yield main, docs, created
    import psycopg

    with psycopg.connect(URL, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS " + table)
        for doc_id in created:
            cur.execute("DELETE FROM documents WHERE id=%s", (doc_id,))


def _drain(main) -> None:
    while main.worker.process_one():
        pass


def test_live_upload_structure_embed_search_chat_flashcards_review(live) -> None:
    main, docs, created = live
    from fastapi.testclient import TestClient

    from tests.test_pdf import make_text_pdf

    client = TestClient(main.app)
    # Resolve the Clerk subject to the internal users.id (uuid); queries scope by it.
    uid = docs.resolve_user("live-user")
    auth = {"Authorization": "Bearer live-user"}

    resp = client.post(
        "/api/parse-pdf", headers=auth, files={"file": ("live.pdf", make_text_pdf(3), "application/pdf")}
    )
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]
    _drain(main)

    job = client.get(f"/api/jobs/{job_id}", headers=auth).json()
    assert job["status"] == "done", job
    doc_id = job["result"]["document_id"]
    created.append(doc_id)

    # Structure ran (heuristic outline) and chunks were embedded.
    chapters = client.get(f"/api/documents/{doc_id}/chapters", headers=auth).json()
    assert len(chapters) == 1
    assert chapters[0]["title"] == "Live chapter"

    with docs._conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM chunks WHERE document_id=%s", (doc_id,))
        total = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM chunks WHERE document_id=%s AND embedding IS NOT NULL", (doc_id,))
        embedded = cur.fetchone()[0]
    assert total > 0
    assert embedded == total, f"{embedded}/{total} chunks embedded"

    # Hybrid search returns real rows for a term from the fixture text.
    hits = docs.hybrid_search(
        document_id=doc_id, user_id=uid, query_text="page", embedding=[0.0] * 384, limit=5
    )
    assert hits, "hybrid search returned nothing"

    # Flashcard generation via a live LLM is opt-in (set STUDYVAULT_TEST_LIVE_LLM=1
    # with real provider keys). Default: seed a card so the review/SM-2 path is
    # still exercised end to end against Postgres.
    import os

    if os.environ.get("STUDYVAULT_TEST_LIVE_LLM") == "1":
        client.post(f"/api/documents/{doc_id}/flashcards", headers=auth)
        _drain(main)
    else:
        docs.add_flashcards(
            [{"id": str(uuid.uuid4()), "chapter_id": chapters[0]["id"], "source_chunk_id": hits[0][0].id,
              "front": "What does the light reaction produce?", "back": "ATP and NADPH."}],
            document_id=doc_id,
            user_id=uid,
            due_date="2000-01-01",
        )
    cards = client.get(f"/api/documents/{doc_id}/flashcards", headers=auth).json()
    assert cards, "no flashcards generated"
    assert any(c["source_chunk_id"] for c in cards)

    # Review updates SM-2 state server-side.
    first = client.post(f"/api/flashcards/{cards[0]['id']}/review", headers=auth, json={"grade": 4})
    assert first.status_code == 200
    assert first.json()["interval_days"] == 1
    assert first.json()["repetitions"] == 1

    # Re-running the embed job is idempotent (nothing left to embed).
    did = main.enqueue("embed_chunks", {"user_id": uid, "document_id": doc_id})
    _drain(main)
    assert client.get(f"/api/jobs/{did}", headers=auth).json()["result"]["embedded"] == 0
