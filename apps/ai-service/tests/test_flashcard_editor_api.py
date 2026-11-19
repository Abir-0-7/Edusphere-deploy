"""Card editing, quality feedback, retirement and deletion acceptance."""

from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.main import app, documents

client = TestClient(app)


def _add_card(owner: str) -> tuple[str, str]:
    doc = documents.create(user_id=owner, filename="notes.pdf", mime_type="application/pdf", size_bytes=10)
    card_id, chapter_id, chunk_id = (str(uuid4()) for _ in range(3))
    chapter = ChapterRecord(chapter_id, doc.id, owner, "Biology", 0, 1, 1)
    chunk = ChunkRecord(chunk_id, doc.id, owner, chapter_id, "Mitosis is cell division.", 1, 0)
    documents.replace_structure(doc.id, [chapter], [chunk])
    documents.add_flashcards(
        [{
            "id": card_id, "chapter_id": chapter_id, "source_chunk_id": chunk_id,
            "source_quote": "Mitosis is cell division.", "front": "What is mitosis?",
            "back": "Cell division.", "tags": ["biology"],
        }],
        document_id=doc.id,
        user_id=owner,
        due_date="2026-12-10",
    )
    return doc.id, card_id


def test_content_edit_versions_preserve_review_history_and_tag_only_edit_does_not_version():
    assert isinstance(documents, InMemoryDocumentStore)
    owner = "flashcard-editor-api-owner"
    document_id, card_id = _add_card(owner)
    documents.atomic_review(
        card_id=card_id,
        user_id=owner,
        grade=4,
        review_id=str(uuid4()),
        now=datetime(2026, 11, 19, tzinfo=UTC),
    )
    before = dict(documents.get_flashcard_for_user(card_id, owner) or {})
    headers = {"Authorization": f"Bearer {owner}"}

    tagged = client.patch(f"/api/flashcards/{card_id}", headers=headers, json={"tags": ["biology", "exam"]})
    assert tagged.status_code == 200, tagged.text
    assert tagged.json()["tags"] == ["biology", "exam"]
    assert len(documents._flashcard_versions[card_id]) == 1

    edited = client.patch(
        f"/api/flashcards/{card_id}",
        headers=headers,
        json={"back": "Cell division that produces two daughter cells."},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["needs_review"] is True
    after = documents.get_flashcard_for_user(card_id, owner)
    assert after is not None
    assert after["id"] == before["id"]
    assert after["repetitions"] == before["repetitions"]
    assert after["ease_factor"] == before["ease_factor"]
    assert after["interval_days"] == before["interval_days"]
    assert after["tags"] == ["biology", "exam"]
    assert [version["version"] for version in documents._flashcard_versions[card_id]] == [1, 2]


def test_report_is_owner_scoped_retirement_is_hidden_by_default_and_delete_cascades_history():
    assert isinstance(documents, InMemoryDocumentStore)
    owner = "flashcard-quality-api-owner"
    document_id, card_id = _add_card(owner)
    headers = {"Authorization": f"Bearer {owner}"}
    foreign = {"Authorization": "Bearer another-flashcard-user"}

    report = client.post(
        f"/api/flashcards/{card_id}/report", headers=headers,
        json={"reason": "The answer is ambiguous."},
    )
    assert report.status_code == 200, report.text
    assert report.json()["status"] == "received"
    assert documents._quality_reports[-1]["reason"] == "The answer is ambiguous."
    assert client.post(
        f"/api/flashcards/{card_id}/report", headers=foreign, json={"reason": "Wrong."}
    ).status_code == 404
    assert client.patch(
        f"/api/flashcards/{card_id}", headers=foreign, json={"front": "Tamper?"}
    ).status_code == 404

    retired = client.post(f"/api/flashcards/{card_id}/retire", headers=headers)
    assert retired.status_code == 200, retired.text
    assert retired.json()["status"] == "retired"
    assert client.get(f"/api/documents/{document_id}/flashcards", headers=headers).json() == []
    assert client.get(
        f"/api/documents/{document_id}/flashcards?include_retired=true", headers=headers
    ).json()[0]["status"] == "retired"

    active_doc, active_card = _add_card(owner)
    documents.atomic_review(
        card_id=active_card, user_id=owner, grade=3, review_id=str(uuid4()),
        now=datetime(2026, 11, 19, tzinfo=UTC),
    )
    deleted = client.delete(f"/api/flashcards/{active_card}", headers=headers)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"card_id": active_card, "deleted": True}
    assert documents._flashcard_versions.get(active_card) is None
    assert not any(row.get("flashcard_id") == active_card for row in documents._reviews)
    assert not any(row.get("card_id") == active_card for row in documents._quality_reports)
    assert client.get(f"/api/documents/{active_doc}/flashcards", headers=headers).json() == []
