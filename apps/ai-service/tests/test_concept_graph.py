"""Saved concept graph contract, source evidence, ownership and revision tests."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.concept_graph.contracts import ConceptGraph
from app.concept_graph.store import MemoryConceptGraphStore
from app.documents.store import ChapterRecord, ChunkRecord
from app.errors import Conflict
from app.main import app, documents

client = TestClient(app)


def graph_fixture(document_id: str, chunk_id: str, chapter_id: str) -> dict:
    return {
        "version": 1,
        "nodes": [
            {"id": "root", "label": "Document", "kind": "root", "evidence_ids": []},
            {
                "id": "concept", "label": "Albedo", "kind": "objective",
                "objective_id": "objective.albedo", "evidence_ids": ["e1"],
            },
        ],
        "edges": [{
            "id": "edge1", "source": "root", "target": "concept", "relation": "supports", "evidence_ids": ["e1"],
        }],
        "evidence": [{
            "id": "e1", "source_document_id": document_id, "chunk_id": chunk_id,
            "chapter_id": chapter_id, "page": 1, "kind": "definition", "quote": "Albedo is surface reflectivity.",
        }],
        "layout": {"root": {"x": 0, "y": 0}},
    }


def test_contract_rejects_invalid_endpoints_duplicate_edges_and_prerequisite_cycles():
    valid = graph_fixture(str(uuid4()), str(uuid4()), str(uuid4()))
    with pytest.raises(ValueError, match="node IDs"):
        ConceptGraph.model_validate({**valid, "nodes": [valid["nodes"][0], valid["nodes"][0]]})
    with pytest.raises(ValueError, match="objective IDs"):
        duplicate_objectives = {
            **valid,
            "nodes": [
                *valid["nodes"],
                {
                    "id": "concept-2", "label": "Albedo", "kind": "objective",
                    "objective_id": "objective.albedo", "evidence_ids": ["e1"],
                },
            ],
        }
        ConceptGraph.model_validate(duplicate_objectives)
    with pytest.raises(ValueError, match="endpoint"):
        ConceptGraph.model_validate({**valid, "edges": [{**valid["edges"][0], "target": "missing"}]})
    with pytest.raises(ValueError, match="duplicate typed edge"):
        ConceptGraph.model_validate({**valid, "edges": [valid["edges"][0], {**valid["edges"][0], "id": "edge2"}]})
    cycle = {
        **valid,
        "nodes": [
            *valid["nodes"],
            {
                "id": "concept-2", "label": "Reflectivity", "kind": "objective",
                "objective_id": "objective.reflectivity", "evidence_ids": ["e1"],
            },
        ],
        "edges": [
            {"id": "p1", "source": "concept", "target": "concept-2", "relation": "prerequisite", "evidence_ids": []},
            {"id": "p2", "source": "concept-2", "target": "concept", "relation": "prerequisite", "evidence_ids": []},
        ],
    }
    with pytest.raises(ValueError, match="acyclic"):
        ConceptGraph.model_validate(cycle)
    containment_cycle = {**cycle, "edges": [{**edge, "relation": "contains"} for edge in cycle["edges"]]}
    with pytest.raises(ValueError, match="acyclic"):
        ConceptGraph.model_validate(containment_cycle)


def test_memory_store_revision_conflict_is_owner_scoped():
    document_id = str(uuid4())
    graph = ConceptGraph.model_validate(graph_fixture(document_id, str(uuid4()), str(uuid4())))
    store = MemoryConceptGraphStore()
    first = store.save("alice", document_id, graph, expected_revision=None)
    second = store.save("alice", document_id, graph, expected_revision=first.revision)
    assert second.revision == 2 and store.get("bob", document_id) is None
    with pytest.raises(Conflict):
        store.save("alice", document_id, graph, expected_revision=1)


def test_api_checks_exact_owner_source_evidence_and_import_document_match():
    owner = f"graph-owner-{uuid4()}"
    document = documents.create(user_id=owner, filename="graph.pdf", mime_type="application/pdf", size_bytes=1)
    chapter_id, chunk_id = str(uuid4()), str(uuid4())
    chapter = ChapterRecord(chapter_id, document.id, owner, "Basics", 0, 1, 1)
    chunk = ChunkRecord(chunk_id, document.id, owner, chapter_id, "Albedo is surface reflectivity.", 1, 0)
    documents.replace_structure(document.id, [chapter], [chunk])
    body = {"graph": graph_fixture(document.id, chunk_id, chapter_id)}
    headers = {"Authorization": f"Bearer {owner}"}
    saved = client.put(f"/api/documents/{document.id}/concept-graph", headers=headers, json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1
    loaded = client.get(f"/api/documents/{document.id}/concept-graph", headers=headers)
    assert loaded.status_code == 200 and loaded.json()["graph"]["layout"]["root"]["x"] == 0
    imported = client.post(
        f"/api/documents/{document.id}/concept-graph/import",
        headers=headers,
        json={"source_document_id": document.id, "graph": body["graph"], "expected_revision": 1},
    )
    assert imported.status_code == 200 and imported.json()["revision"] == 2
    stale = client.put(
        f"/api/documents/{document.id}/concept-graph", headers=headers,
        json={**body, "expected_revision": 5},
    )
    assert stale.status_code == 409
    wrong_source = client.post(
        f"/api/documents/{document.id}/concept-graph/import", headers=headers,
        json={"source_document_id": str(uuid4()), **body},
    )
    assert wrong_source.status_code in {400, 404}
    foreign_owner = f"graph-foreign-{uuid4()}"
    foreign_document = documents.create(
        user_id=foreign_owner, filename="foreign.pdf", mime_type="application/pdf", size_bytes=1
    )
    unauthorized_import = client.post(
        f"/api/documents/{document.id}/concept-graph/import",
        headers=headers,
        json={"source_document_id": foreign_document.id, **body},
    )
    assert unauthorized_import.status_code == 404
    forged_source = graph_fixture(str(uuid4()), chunk_id, chapter_id)
    forged = client.put(
        f"/api/documents/{document.id}/concept-graph", headers=headers, json={"graph": forged_source}
    )
    assert forged.status_code == 400
    forged_chunk = graph_fixture(document.id, str(uuid4()), chapter_id)
    response = client.put(
        f"/api/documents/{document.id}/concept-graph", headers=headers, json={"graph": forged_chunk}
    )
    assert response.status_code == 400
    assert client.get(
        f"/api/documents/{document.id}/concept-graph", headers={"Authorization": "Bearer another-graph-owner"}
    ).status_code == 404


def test_import_rejects_oversized_graph_payload():
    owner = f"graph-large-{uuid4()}"
    document = documents.create(user_id=owner, filename="large.pdf", mime_type="application/pdf", size_bytes=1)
    chapter_id, chunk_id = str(uuid4()), str(uuid4())
    chapter = ChapterRecord(chapter_id, document.id, owner, "Basics", 0, 1, 1)
    chunk = ChunkRecord(chunk_id, document.id, owner, chapter_id, "Evidence.", 1, 0)
    documents.replace_structure(document.id, [chapter], [chunk])
    graph = graph_fixture(document.id, chunk_id, chapter_id)
    graph["layout"] = {"imported": "x" * (512 * 1024)}
    response = client.post(
        f"/api/documents/{document.id}/concept-graph/import",
        headers={"Authorization": f"Bearer {owner}"},
        json={"source_document_id": document.id, "graph": graph},
    )
    assert response.status_code == 400
