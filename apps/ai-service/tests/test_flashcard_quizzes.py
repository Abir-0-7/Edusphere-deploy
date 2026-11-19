"""Source quiz session privacy, grading, replay, and CSV formula-injection checks."""

import csv
import io
import json
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.documents.store import ChapterRecord, ChunkRecord
from app.errors import Conflict, InvalidInput, NotFound
from app.flashcard_studio.quiz import (
    MemoryQuizSessionStore,
    PgQuizSessionStore,
    build_quiz,
    export_cards_csv,
    grade_answers,
)
from app.flashcard_studio.quiz_contracts import QuizGradeRequest
from app.main import app, documents, flashcard_studio_store

client = TestClient(app)


def _source_fixture(owner: str):
    doc = documents.create(user_id=owner, filename="quiz.pdf", mime_type="application/pdf", size_bytes=32)
    chapter = ChapterRecord(str(uuid4()), doc.id, owner, "Basics", 0, 1, 2)
    chunks = [
        ChunkRecord(str(uuid4()), doc.id, owner, chapter.id, "Albedo means surface reflectivity.", 1, 0),
        ChunkRecord(str(uuid4()), doc.id, owner, chapter.id, "A nebula is a cloud of gas and dust.", 2, 1),
        ChunkRecord(str(uuid4()), doc.id, owner, chapter.id, "An orbit is a path around a body.", 2, 2),
    ]
    documents.replace_structure(doc.id, [chapter], chunks)
    cards = [
        {
            "id": str(uuid4()), "chapter_id": chapter.id, "source_chunk_id": chunk.id,
            "source_quote": chunk.content, "front": front, "back": back,
        }
        for chunk, front, back in zip(
            chunks,
            ("What does albedo describe?", "What is a nebula?", "What is an orbit?"),
            ("Surface reflectivity.", "A cloud of gas and dust.", "A path around a body."),
            strict=True,
        )
    ]
    documents.add_flashcards(cards, document_id=doc.id, user_id=owner, due_date="2026-11-19")
    deck = next(item for item in flashcard_studio_store.list_decks(doc.id, owner) if item.is_default)
    return doc, deck, cards, chunks


def test_quiz_answers_are_hidden_until_grading_and_owner_scoped_with_safe_replay():
    owner = f"quiz-owner-{uuid4()}"
    doc, deck, cards, _chunks = _source_fixture(owner)
    headers = {"Authorization": f"Bearer {owner}"}
    start = client.post(
        f"/api/documents/{doc.id}/flashcard-quizzes",
        headers=headers,
        json={"deck_id": str(deck.id), "count": 3},
    )
    assert start.status_code == 200, start.text
    session = start.json()
    assert len(session["questions"]) == 3
    assert "answer_key" not in session
    assert all("source_quote" not in question and "page" not in question for question in session["questions"])
    assert all("correct" not in choice for question in session["questions"] for choice in question["choices"])

    other = client.get(
        f"/api/flashcard-quizzes/{session['id']}", headers={"Authorization": f"Bearer other-{uuid4()}"}
    )
    assert other.status_code == 404
    loaded = client.get(f"/api/flashcard-quizzes/{session['id']}", headers=headers)
    assert loaded.status_code == 200 and loaded.json() == session

    answers = []
    for question in session["questions"]:
        source_card = next(card for card in cards if card["front"] == question["prompt"])
        correct = next(choice for choice in question["choices"] if choice["text"] == source_card["back"])
        answers.append({"question_id": question["id"], "choice_id": correct["id"]})
    graded = client.post(
        f"/api/flashcard-quizzes/{session['id']}/grade", headers=headers, json={"answers": answers}
    )
    assert graded.status_code == 200, graded.text
    result = graded.json()
    assert result["correct"] == result["total"] == result["answered"] == 3
    assert result["percent"] == 100
    assert len(result["feedback"]) == 3
    assert all(item["correct"] and item["source_quote"] for item in result["feedback"])
    retry = client.post(
        f"/api/flashcard-quizzes/{session['id']}/grade", headers=headers, json={"answers": answers}
    )
    assert retry.status_code == 200 and retry.json() == result
    wrong_retry = client.post(
        f"/api/flashcard-quizzes/{session['id']}/grade",
        headers=headers,
        json={"answers": answers[:-1]},
    )
    assert wrong_retry.status_code == 409


def test_quiz_rejects_duplicate_answers_and_untrusted_or_invalid_source_cards():
    doc_id, deck_id = str(uuid4()), str(uuid4())
    cards = [
        {"id": str(uuid4()), "front": "Question one?", "back": "Answer one"},
        {"id": str(uuid4()), "front": "Question two?", "back": "Answer two"},
    ]
    sources = {card["id"]: {"source_quote": f"Evidence {index}", "page": index} for index, card in enumerate(cards, 1)}
    session, key = build_quiz(
        document_id=doc_id,
        deck_id=deck_id,
        cards=cards,
        source_for_card=lambda card_id: sources[card_id],
        count=2,
    )
    public = session.model_dump(mode="json")
    assert set(public) == {"id", "document_id", "deck_id", "questions"}
    assert all(set(question) == {"id", "prompt", "choices"} for question in public["questions"])
    assert all("choice_id" in value and "source_quote" in value for value in key.values())
    question = session.questions[0]
    request = {"answers": [
        {"question_id": str(question.id), "choice_id": str(question.choices[0].id)},
        {"question_id": str(question.id), "choice_id": str(question.choices[1].id)},
    ]}
    with pytest.raises(InvalidInput):
        grade_answers(str(session.id), [item.model_dump(mode="json") for item in session.questions], key, request)
    with pytest.raises(InvalidInput):
        build_quiz(document_id=doc_id, deck_id=deck_id, cards=cards, source_for_card=lambda _id: None, count=2)


def test_memory_quiz_store_hides_key_and_rejects_invalid_replay():
    owner = "quiz-memory-owner"
    doc_id, deck_id = str(uuid4()), str(uuid4())
    cards = [
        {"id": str(uuid4()), "front": f"Question {index}?", "back": f"Answer {index}"}
        for index in range(3)
    ]
    session, key = build_quiz(
        document_id=doc_id,
        deck_id=deck_id,
        cards=cards,
        source_for_card=lambda card_id: {"source_quote": f"Quote for {card_id}", "page": None},
        count=3,
    )
    store = MemoryQuizSessionStore()
    store.create(owner, session, key)
    assert "answer_key" not in store.get(owner, str(session.id))
    question = session.questions[0]
    first = QuizGradeRequest(answers=[{"question_id": str(question.id), "choice_id": str(question.choices[0].id)}])
    saved = store.grade(owner, str(session.id), first)
    assert store.grade(owner, str(session.id), first) == saved
    different = QuizGradeRequest(answers=[])
    with pytest.raises(Conflict):
        store.grade(owner, str(session.id), different)
    with pytest.raises(NotFound):
        store.get("another-owner", str(session.id))


@pytest.mark.parametrize(
    "payload",
    ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1:A2)", "\t=1+1", " \r\n=HYPERLINK(\"x\")"],
)
def test_csv_export_escapes_formula_like_cells(payload):
    card = {"id": "card-1", "front": payload, "back": "Safe answer", "tags": []}
    text = export_cards_csv([card], lambda _card_id: {"source_quote": payload, "page": None, "chapter_id": None})
    rows = list(csv.reader(io.StringIO(text, newline="")))
    assert rows[0] == ["front", "back", "source_quote", "page", "chapter_id", "tags"]
    assert rows[1][0] == "'" + payload
    assert rows[1][2] == "'" + payload


def test_csv_export_quotes_commas_quotes_and_newlines_and_enforces_bound():
    card = {"id": "card-1", "front": 'Question, "quoted"\nnext line', "back": "A, B", "tags": ["one", "two"]}
    text = export_cards_csv(
        [card], lambda _card_id: {"source_quote": "Evidence, with\nline", "page": 2, "chapter_id": "chapter"}
    )
    rows = list(csv.reader(io.StringIO(text, newline="")))
    assert rows[1][:3] == [card["front"], card["back"], "Evidence, with\nline"]
    with pytest.raises(InvalidInput):
        export_cards_csv([{}] * 2001, lambda _card_id: None)


def test_csv_endpoint_is_owner_scoped_and_escapes_saved_formula_values():
    owner = f"csv-owner-{uuid4()}"
    doc, deck, cards, _chunks = _source_fixture(owner)
    documents.edit_flashcard(
        cards[0]["id"], owner, front="\t=HYPERLINK(\"https://example.invalid\")", back="@SUM(A1:A2)"
    )
    headers = {"Authorization": f"Bearer {owner}"}
    exported = client.get(
        f"/api/documents/{doc.id}/flashcard-decks/{deck.id}/export.csv", headers=headers
    )
    assert exported.status_code == 200
    rows = list(csv.reader(io.StringIO(exported.text, newline="")))
    first = next(row for row in rows[1:] if row[0].startswith("'"))
    assert first[0] == "'\t=HYPERLINK(\"https://example.invalid\")"
    assert first[1] == "'@SUM(A1:A2)"
    other = client.get(
        f"/api/documents/{doc.id}/flashcard-decks/{deck.id}/export.csv",
        headers={"Authorization": f"Bearer other-{uuid4()}"},
    )
    assert other.status_code == 404


def test_postgres_quiz_store_uses_owner_scoped_reads_and_durable_grade():
    user_id, session_id = str(uuid4()), str(uuid4())
    doc_id, deck_id = str(uuid4()), str(uuid4())
    card_id = str(uuid4())
    session, answer_key = build_quiz(
        document_id=doc_id,
        deck_id=deck_id,
        cards=[
            {"id": card_id, "front": "Question one?", "back": "Answer one"},
            {"id": str(uuid4()), "front": "Question two?", "back": "Answer two"},
        ],
        source_for_card=lambda source_id: {"source_quote": f"Evidence from {source_id}", "page": 1},
        count=2,
    )
    session = session.model_copy(update={"id": UUID(session_id)})
    question = session.questions[0]
    right_choice = answer_key[str(question.id)]["choice_id"]
    request = QuizGradeRequest(answers=[{"question_id": str(question.id), "choice_id": right_choice}])
    connection = MagicMock()
    connection.__enter__.return_value = connection
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    connection.cursor.return_value = cursor
    cursor.rowcount = 1
    cursor.fetchone.side_effect = [
        (
            [item.model_dump(mode="json") for item in session.questions],
            answer_key,
            None,
            None,
        )
    ]
    store = PgQuizSessionStore.__new__(PgQuizSessionStore)
    store._database_url = "postgresql://not-used-in-unit-test"
    store._conn = connection
    store._connect = MagicMock(return_value=connection)

    result = store.grade(user_id, session_id, request)

    assert result.answered == result.correct == 1
    select = cursor.execute.call_args_list[0]
    assert "WHERE id=%s AND user_id=%s FOR UPDATE" in select.args[0]
    assert select.args[1] == (session_id, user_id)
    update = cursor.execute.call_args_list[1]
    assert "WHERE id=%s AND user_id=%s" in update.args[0]
    assert update.args[1][-2:] == (session_id, user_id)


def test_postgres_quiz_creation_is_bound_to_owner_deck_selection():
    user_id, session_id = str(uuid4()), str(uuid4())
    doc_id, deck_id = str(uuid4()), str(uuid4())
    session, answer_key = build_quiz(
        document_id=doc_id,
        deck_id=deck_id,
        cards=[
            {"id": str(uuid4()), "front": "Question one?", "back": "Answer one"},
            {"id": str(uuid4()), "front": "Question two?", "back": "Answer two"},
        ],
        source_for_card=lambda card_id: {"source_quote": f"Evidence {card_id}", "page": 1},
        count=2,
    )
    session = session.model_copy(update={"id": UUID(session_id)})
    connection = MagicMock()
    connection.__enter__.return_value = connection
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.rowcount = 1
    connection.cursor.return_value = cursor
    store = PgQuizSessionStore.__new__(PgQuizSessionStore)
    store._database_url = "postgresql://not-used-in-unit-test"
    store._connect = MagicMock(return_value=connection)

    store.create(user_id, session, answer_key)

    query, params = cursor.execute.call_args.args
    assert "SELECT %s,d.user_id,d.document_id,d.id" in query
    assert "d.id=%s AND d.document_id=%s AND d.user_id=%s" in query
    assert params[-3:] == (deck_id, doc_id, user_id)
    assert json.loads(params[-5]) == [question.model_dump(mode="json") for question in session.questions]
    assert json.loads(params[-4]) == answer_key

