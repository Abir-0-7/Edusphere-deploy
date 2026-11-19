"""Optional disposable-Postgres CAS, evidence invalidation and graph overlay acceptance."""

import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from app.concept_graph.actions import grounded_graph, regenerate_graph
from app.concept_graph.store import PgConceptGraphStore
from app.documents.store import ChapterRecord, ChunkRecord, DocumentRecord
from app.errors import Conflict

URL = os.getenv("STUDYVAULT_GRAPH_TEST_DATABASE_URL") or os.getenv("STUDYVAULT_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="A disposable Postgres graph test URL is not configured")


def test_pg_graph_cas_evidence_invalidation_preserves_annotations_and_layout_then_source_cascade():
    import psycopg

    owner, document_id, chapter_id, chunk_id = (str(uuid4()) for _ in range(4))
    document = DocumentRecord(document_id, owner, "graph-d08.pdf", "application/pdf", 1)
    chapter = ChapterRecord(chapter_id, document_id, owner, "Light", 0, 1, 1)
    chunk = ChunkRecord(chunk_id, document_id, owner, chapter_id, "Chlorophyll absorbs light.", 1, 0)
    document.chapters = [chapter]
    document.chunks = [chunk]
    graph = grounded_graph(document)
    graph.annotations[f"chunk:{chunk_id}"] = "Keep this learner annotation."
    graph.layout = {
        "positions": {f"chunk:{chunk_id}": {"x": 480, "y": 144}},
        "viewport": {"x": 28, "y": 60, "scale": 1.2},
    }
    store = PgConceptGraphStore(URL)
    with psycopg.connect(URL, autocommit=True) as conn:
        try:
            columns = {row[0] for row in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'"
            ).fetchall()}
            if "clerk_id" in columns:
                conn.execute(
                    "INSERT INTO users (id,clerk_id,email) VALUES (%s,%s,%s)",
                    (owner, f"graph-d08-{owner}", f"{owner}@graph.test"),
                )
            else:
                conn.execute("INSERT INTO users (id) VALUES (%s)", (owner,))
            conn.execute(
                "INSERT INTO documents (id,user_id,filename,mime_type,size_bytes) VALUES (%s,%s,%s,%s,%s)",
                (document_id, owner, document.filename, document.mime_type, 1),
            )
            conn.execute(
                "INSERT INTO chapters (id,document_id,user_id,title,ordinal,start_page,end_page) "
                "VALUES (%s,%s,%s,%s,0,1,1)",
                (chapter_id, document_id, owner, chapter.title),
            )
            conn.execute(
                "INSERT INTO chunks (id,document_id,user_id,chapter_id,content,page,ordinal) "
                "VALUES (%s,%s,%s,%s,%s,1,0)",
                (chunk_id, document_id, owner, chapter_id, chunk.content),
            )
            first = store.save(owner, document_id, graph, expected_revision=None)

            def update(_):
                try:
                    return store.save(owner, document_id, graph, expected_revision=first.revision).revision
                except Conflict:
                    return None

            with ThreadPoolExecutor(max_workers=4) as pool:
                outcomes = list(pool.map(update, range(8)))
            assert outcomes.count(2) == 1 and outcomes.count(None) == 7
            before = store.get(owner, document_id)
            assert before.revision == 2
            assert store.get(str(uuid4()), document_id) is None
            conn.execute("UPDATE chunks SET content=%s WHERE id=%s AND user_id=%s", (
                "Updated source after reprocessing.", chunk_id, owner,
            ))
            with pytest.raises(Conflict, match="source changed"):
                store.save(owner, document_id, graph, expected_revision=2)
            assert store.get(owner, document_id).revision == 2
            document.chunks[0].content = "Updated source after reprocessing."
            regenerated = regenerate_graph(before.graph, grounded_graph(document), document)
            third = store.save(owner, document_id, regenerated, expected_revision=2)
            assert third.revision == 3 and third.graph.annotations == graph.annotations
            assert third.graph.layout == graph.layout
            conn.execute("DELETE FROM documents WHERE id=%s AND user_id=%s", (document_id, owner))
            assert store.get(owner, document_id) is None
        finally:
            conn.execute("DELETE FROM users WHERE id=%s", (owner,))
