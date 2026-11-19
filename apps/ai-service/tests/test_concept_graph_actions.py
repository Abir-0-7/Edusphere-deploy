"""Map-to-learning actions use exact current owner/source identity and preserve graph edits."""

from uuid import uuid4

from fastapi.testclient import TestClient

from app.concept_graph.actions import grounded_graph, regenerate_graph
from app.concept_graph.contracts import ConceptGraph
from app.courses.catalog import stable_id
from app.documents.store import ChapterRecord, ChunkRecord, DocumentRecord
from app.main import app, course_store, documents, flashcard_studio_store

client = TestClient(app)


def source_fixture():
    owner = f"graph-actions-{uuid4()}"
    document = documents.create(user_id=owner, filename="source.pdf", mime_type="application/pdf", size_bytes=1)
    chapter_id, chunk_id = str(uuid4()), str(uuid4())
    chapter = ChapterRecord(chapter_id, document.id, owner, "Light", 0, 1, 1)
    chunk = ChunkRecord(chunk_id, document.id, owner, chapter_id, "Chlorophyll absorbs light energy.", 1, 0)
    documents.replace_structure(document.id, [chapter], [chunk])
    return owner, document, chapter, chunk


def graph_json(document: DocumentRecord):
    return grounded_graph(document).model_dump(mode="json")


def save_graph(owner, document, graph):
    return client.put(
        f"/api/documents/{document.id}/concept-graph",
        headers={"Authorization": f"Bearer {owner}"}, json={"graph": graph},
    )


def test_node_actions_resolve_owned_source_and_deck_without_scheduling_or_untrusted_urls():
    owner, document, chapter, chunk = source_fixture()
    card_id = str(uuid4())
    documents.add_flashcards([{
        "id": card_id, "chapter_id": chapter.id, "source_chunk_id": chunk.id,
        "source_quote": "Chlorophyll absorbs light energy.", "front": "What absorbs light?", "back": "Chlorophyll.",
    }], document_id=document.id, user_id=owner, due_date="2026-11-19")
    default = flashcard_studio_store.list_decks(document.id, owner)[0]
    graph = graph_json(document)
    saved = save_graph(owner, document, graph)
    assert saved.status_code == 200, saved.text
    node_id = f"chunk:{chunk.id}"
    path = f"/api/documents/{document.id}/concept-graph/nodes/{node_id}/actions?revision=1"
    headers = {"Authorization": f"Bearer {owner}"}
    response = client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    actions = response.json()
    assert actions["source"] == {
        "document_id": document.id, "chapter_id": chapter.id, "chunk_id": chunk.id,
        "page": 1, "quote": chunk.content,
    }
    assert actions["deck"] == {
        "document_id": document.id, "deck_id": str(default.id), "card_ids": [card_id],
    }
    assert actions["board"]["quote"] == chunk.content
    assert actions["lesson"] is None
    assert "href" not in response.text
    assert documents.get_flashcard_for_user(card_id, owner)["repetitions"] == 0
    assert client.get(path, headers={"Authorization": "Bearer unrelated-owner"}).status_code == 404
    assert client.get(path.replace("revision=1", "revision=8"), headers=headers).status_code == 409
    assert client.get(path.replace(node_id, "missing"), headers=headers).status_code == 404
    root_actions = client.get(path.replace(node_id, f"document:{document.id}"), headers=headers)
    assert root_actions.status_code == 200 and root_actions.json()["source"] is None
    chunk.content = "Replaced source material."
    stale = client.get(path, headers=headers)
    assert stale.status_code == 409


def test_pinned_owned_course_lesson_resolves_by_materialized_chapter_and_shared_objective_only():
    owner = f"graph-course-{uuid4()}"
    session = course_store.enroll(owner, "python-foundations")
    document = documents.get_for_user(str(session.document_id), owner)
    graph = grounded_graph(document, course_store).model_dump(mode="json")
    objective_node = next(item for item in graph["nodes"] if item["kind"] == "objective")
    saved = save_graph(owner, document, graph)
    assert saved.status_code == 200, saved.text
    path = (
        f"/api/documents/{document.id}/concept-graph/nodes/{objective_node['id']}/actions?revision=1"
    )
    response = client.get(path, headers={"Authorization": f"Bearer {owner}"})
    assert response.status_code == 200, response.text
    target = response.json()["lesson"]
    assert target["enrollment_id"] == str(session.id)
    assert target["lesson_id"] == session.lessons[0].id
    assert target["objective_id"] in session.lessons[0].objective_ids
    assert target["content"] == document.chunks[0].content
    assert str(response.json()["source"]["chapter_id"]) == stable_id(
        f"{session.id}/chapter/{target['lesson_id']}"
    )
    objective_node["objective_id"] = "forged-objective"
    updated = client.put(
        f"/api/documents/{document.id}/concept-graph",
        headers={"Authorization": f"Bearer {owner}"}, json={"graph": graph, "expected_revision": 1},
    )
    assert updated.status_code == 200, updated.text
    forged = client.get(path.replace("revision=1", "revision=2"), headers={"Authorization": f"Bearer {owner}"})
    assert forged.status_code == 200 and forged.json()["lesson"] is None
    objective_node["objective_id"] = target["objective_id"]
    updated = client.put(
        f"/api/documents/{document.id}/concept-graph",
        headers={"Authorization": f"Bearer {owner}"}, json={"graph": graph, "expected_revision": 2},
    )
    assert updated.status_code == 200, updated.text
    document.chunks[0].content += "\nSource text changed after enrollment materialization."
    changed_material = client.get(
        path.replace("revision=1", "revision=3"), headers={"Authorization": f"Bearer {owner}"},
    )
    assert changed_material.status_code == 200 and changed_material.json()["lesson"] is None
    assert course_store.get_session(owner, str(session.id)).revision == session.revision


def test_imported_node_identifier_with_encoded_slash_still_resolves_only_saved_evidence():
    owner, document, _, chunk = source_fixture()
    graph = graph_json(document)
    original_id = f"chunk:{chunk.id}"
    for node in graph["nodes"]:
        if node["id"] == original_id:
            node["id"] = "concept/source"
    for edge in graph["edges"]:
        if edge["target"] == original_id:
            edge["target"] = "concept/source"
    saved = save_graph(owner, document, graph)
    assert saved.status_code == 200, saved.text
    response = client.get(
        f"/api/documents/{document.id}/concept-graph/nodes/concept%2Fsource/actions?revision=1",
        headers={"Authorization": f"Bearer {owner}"},
    )
    assert response.status_code == 200 and response.json()["node_id"] == "concept/source"
    assert response.json()["source"]["chunk_id"] == chunk.id


def test_regeneration_keeps_annotations_layout_labels_and_manual_nodes_then_revision_checks():
    owner, document, chapter, chunk = source_fixture()
    graph = graph_json(document)
    source_node_id = f"chunk:{chunk.id}"
    graph["nodes"].append({
        "id": "learner-note", "label": "My cross-link", "kind": "concept", "objective_id": None, "evidence_ids": [],
    })
    graph["nodes"] = [
        {**item, "label": "My phrasing"} if item["id"] == source_node_id else item for item in graph["nodes"]
    ]
    graph["annotations"] = {source_node_id: "Review this before Friday.", "learner-note": "Personal note."}
    graph["layout"] = {
        "positions": {source_node_id: {"x": 350, "y": 120}},
        "viewport": {"x": 16, "y": 28, "scale": 1.4}, "collapsed_ids": [f"chapter:{chapter.id}"],
    }
    saved = save_graph(owner, document, graph)
    assert saved.status_code == 200, saved.text
    original_id = saved.json()["id"]
    chunk.content += " Light is absorbed at specific wavelengths."
    new_chunk = ChunkRecord(str(uuid4()), document.id, owner, chapter.id, "Glucose stores chemical energy.", 1, 1)
    document.chunks.append(new_chunk)
    path = f"/api/documents/{document.id}/concept-graph/regenerate"
    response = client.post(path, headers={"Authorization": f"Bearer {owner}"}, json={"expected_revision": 1})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["id"] == original_id and updated["revision"] == 2
    assert updated["graph"]["annotations"] == graph["annotations"]
    assert updated["graph"]["layout"] == graph["layout"]
    assert next(item for item in updated["graph"]["nodes"] if item["id"] == source_node_id)["label"] == "My phrasing"
    assert any(item["id"] == "learner-note" for item in updated["graph"]["nodes"])
    assert any(item["id"] == f"chunk:{new_chunk.id}" for item in updated["graph"]["nodes"])
    stale = client.post(path, headers={"Authorization": f"Bearer {owner}"}, json={"expected_revision": 1})
    assert stale.status_code == 409
    unauthorized = client.post(
        path, headers={"Authorization": "Bearer unrelated-owner"}, json={"expected_revision": 2},
    )
    assert unauthorized.status_code == 404


def test_source_regeneration_is_identity_based_and_preserves_notes_for_removed_source():
    owner, document, _, chunk = source_fixture()
    first = grounded_graph(document)
    first.annotations[f"chunk:{chunk.id}"] = "Keep this note even if its source goes away."
    before = regenerate_graph(first, grounded_graph(document), document)
    assert [item.id for item in before.nodes] == [item.id for item in first.nodes]
    document.chunks[0].content = "A different replacement source."
    refreshed = regenerate_graph(first, grounded_graph(document), document)
    assert refreshed.annotations == first.annotations
    assert refreshed.evidence[0].quote == document.chunks[0].content
    ConceptGraph.model_validate(refreshed.model_dump(mode="json"))
    old_id = chunk.id
    document.chunks = [ChunkRecord(
        str(uuid4()), document.id, owner, chunk.chapter_id, "New material after source reprocessing.", 1, 0,
    )]
    removed = regenerate_graph(first, grounded_graph(document), document)
    retained = next(item for item in removed.nodes if item.id == f"chunk:{old_id}")
    assert retained.evidence_ids == []
    assert removed.annotations[f"chunk:{old_id}"] == first.annotations[f"chunk:{old_id}"]
    assert all(str(item.chunk_id) != old_id for item in removed.evidence)
