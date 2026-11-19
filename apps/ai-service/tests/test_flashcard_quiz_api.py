"""Authenticated acceptance for source quizzes and deck CSV export."""

import csv
import io
from uuid import uuid4

from fastapi.testclient import TestClient

from app.documents.store import ChapterRecord, ChunkRecord
from app.main import app, documents, flashcard_studio_store

client = TestClient(app)


def test_source_quiz_keeps_key_private_and_grades_without_advancing_review():
    owner = "flashcard-quiz-api-owner"
    doc = documents.create(user_id=owner, filename="quiz.pdf", mime_type="application/pdf", size_bytes=10)
    chapter_id, chunk_id = str(uuid4()), str(uuid4())
    chapter = ChapterRecord(chapter_id, doc.id, owner, "Photosynthesis", 0, 1, 1)
    chunk = ChunkRecord(
        chunk_id,
        doc.id,
        owner,
        chapter_id,
        "Chlorophyll absorbs light. Glucose stores chemical energy.",
        1,
        0,
    )
    documents.replace_structure(doc.id, [chapter], [chunk])
    card_ids = [str(uuid4()), str(uuid4())]
    documents.add_flashcards(
        [
            {
                "id": card_ids[0],
                "chapter_id": chapter_id,
                "source_chunk_id": chunk_id,
                "source_quote": "Chlorophyll absorbs light.",
                "front": "What absorbs light?",
                "back": "Chlorophyll.",
            },
            {
                "id": card_ids[1],
                "chapter_id": chapter_id,
                "source_chunk_id": chunk_id,
                "source_quote": "Glucose stores chemical energy.",
                "front": "What stores chemical energy?",
                "back": "Glucose.",
            },
        ],
        document_id=doc.id,
        user_id=owner,
        due_date="2026-12-10",
    )
    deck_id = str(flashcard_studio_store.list_decks(doc.id, owner)[0].id)
    headers = {"Authorization": f"Bearer {owner}"}

    started = client.post(
        f"/api/documents/{doc.id}/flashcard-quizzes",
        headers=headers,
        json={"deck_id": deck_id, "count": 2},
    )
    assert started.status_code == 200, started.text
    session = started.json()
    assert len(session["questions"]) == 2
    assert "answer_key" not in session
    loaded = client.get(f"/api/flashcard-quizzes/{session['id']}", headers=headers)
    assert loaded.status_code == 200 and "answer_key" not in loaded.json()
    assert (
        client.get(
            f"/api/flashcard-quizzes/{session['id']}", headers={"Authorization": "Bearer another-quiz-owner"}
        ).status_code
        == 404
    )

    question = next(question for question in session["questions"] if question["prompt"] == "What absorbs light?")
    correct = next(choice for choice in question["choices"] if choice["text"] == "Chlorophyll.")
    answers = [{"question_id": question["id"], "choice_id": correct["id"]}]
    result = client.post(f"/api/flashcard-quizzes/{session['id']}/grade", headers=headers, json={"answers": answers})
    assert result.status_code == 200 and result.json()["correct"] == 1
    assert result.json()["feedback"][0]["source_quote"]
    replay = client.post(f"/api/flashcard-quizzes/{session['id']}/grade", headers=headers, json={"answers": answers})
    assert replay.json() == result.json()
    cards = documents.list_flashcards(doc.id, owner)
    assert [card["repetitions"] for card in cards] == [0, 0]


def test_deck_csv_route_escapes_formula_text_and_checks_deck_owner():
    owner = "flashcard-export-api-owner"
    doc = documents.create(user_id=owner, filename="export.pdf", mime_type="application/pdf", size_bytes=10)
    chapter_id, chunk_id, card_id = str(uuid4()), str(uuid4()), str(uuid4())
    chapter = ChapterRecord(chapter_id, doc.id, owner, "Export", 0, 1, 1)
    chunk = ChunkRecord(chunk_id, doc.id, owner, chapter_id, "The source contains safe evidence.", 1, 0)
    documents.replace_structure(doc.id, [chapter], [chunk])
    documents.add_flashcards(
        [
            {
                "id": card_id,
                "chapter_id": chapter_id,
                "source_chunk_id": chunk_id,
                "source_quote": "safe evidence",
                "front": ' =HYPERLINK("https://example.test")',
                "back": "+SUM(1,1)",
                "tags": ["export"],
            }
        ],
        document_id=doc.id,
        user_id=owner,
        due_date="2026-12-10",
    )
    deck_id = str(flashcard_studio_store.list_decks(doc.id, owner)[0].id)
    response = client.get(
        f"/api/documents/{doc.id}/flashcard-decks/{deck_id}/export.csv",
        headers={"Authorization": f"Bearer {owner}"},
    )
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    row = next(csv.DictReader(io.StringIO(response.text)))
    assert row["front"].startswith("'=HYPERLINK")
    assert row["back"].startswith("'+SUM")
    denied = client.get(
        f"/api/documents/{doc.id}/flashcard-decks/{deck_id}/export.csv",
        headers={"Authorization": "Bearer another-export-owner"},
    )
    assert denied.status_code == 404


def test_csv_exports_a_whole_deck_across_store_page_boundaries():
    owner = "paginated-deck-export-owner"
    doc = documents.create(user_id=owner, filename="large.pdf", mime_type="application/pdf", size_bytes=10)
    chapter_id, chunk_id = str(uuid4()), str(uuid4())
    chapter = ChapterRecord(chapter_id, doc.id, owner, "Evidence", 0, 1, 1)
    chunk = ChunkRecord(chunk_id, doc.id, owner, chapter_id, "Every card has this evidence.", 1, 0)
    documents.replace_structure(doc.id, [chapter], [chunk])
    documents.add_flashcards(
        [
            {
                "id": str(uuid4()),
                "chapter_id": chapter_id,
                "source_chunk_id": chunk_id,
                "source_quote": "this evidence",
                "front": f"Question {index}?",
                "back": f"Answer {index}.",
            }
            for index in range(101)
        ],
        document_id=doc.id,
        user_id=owner,
        due_date="2026-12-10",
    )
    deck_id = str(flashcard_studio_store.list_decks(doc.id, owner)[0].id)
    response = client.get(
        f"/api/documents/{doc.id}/flashcard-decks/{deck_id}/export.csv", headers={"Authorization": f"Bearer {owner}"}
    )
    assert response.status_code == 200
    assert len(list(csv.DictReader(io.StringIO(response.text)))) == 101
