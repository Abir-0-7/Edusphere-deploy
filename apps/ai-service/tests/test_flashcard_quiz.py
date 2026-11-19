"""Source-grounded quiz grading and export safety acceptance."""

from uuid import uuid4

import pytest

from app.errors import Conflict, InvalidInput, NotFound
from app.flashcard_studio.quiz import MemoryQuizSessionStore, build_quiz, export_cards_csv, grade_answers
from app.flashcard_studio.quiz_contracts import QuizGradeRequest


def _cards():
    first = str(uuid4())
    second = str(uuid4())
    return [
        {"id": first, "front": "What absorbs light?", "back": "Chlorophyll", "tags": ["bio"]},
        {"id": second, "front": "What stores energy?", "back": "Chemical energy", "tags": []},
    ]


def _source(card_id: str):
    return {
        "source_quote": "The cited source passage.",
        "page": 3,
        "chapter_id": str(uuid4()),
    }


def test_quiz_hides_answer_key_and_replays_same_grade_without_duplicate_effect():
    cards = _cards()
    session, answer_key = build_quiz(
        document_id=str(uuid4()), deck_id=str(uuid4()), cards=cards, source_for_card=_source, count=2,
    )
    assert "answer_key" not in session.model_dump()
    store = MemoryQuizSessionStore()
    owner = "quiz-owner"
    store.create(owner, session, answer_key)
    public = store.get(owner, str(session.id))
    first_question = public["session"].questions[0]
    correct_choice = answer_key[str(first_question.id)]["choice_id"]
    request = QuizGradeRequest(answers=[{"question_id": first_question.id, "choice_id": correct_choice}])
    graded = store.grade(owner, str(session.id), request)
    replay = store.grade(owner, str(session.id), request)
    assert graded == replay and graded.correct == 1 and graded.answered == 1
    with pytest.raises(Conflict):
        store.grade(owner, str(session.id), QuizGradeRequest(answers=[]))
    with pytest.raises(NotFound):
        store.get("another-owner", str(session.id))


def test_quiz_rejects_unknown_or_duplicate_answers_and_export_escapes_formula_cells():
    cards = _cards()
    session, answer_key = build_quiz(
        document_id=str(uuid4()), deck_id=str(uuid4()), cards=cards, source_for_card=_source, count=2,
    )
    question = session.questions[0]
    with pytest.raises(InvalidInput):
        grade_answers(
            str(session.id), [item.model_dump(mode="json") for item in session.questions], answer_key,
            {"answers": [{"question_id": str(question.id), "choice_id": str(uuid4())}]},
        )
    with pytest.raises(InvalidInput):
        grade_answers(
            str(session.id), [item.model_dump(mode="json") for item in session.questions], answer_key,
            {"answers": [
                {"question_id": str(question.id), "choice_id": answer_key[str(question.id)]},
                {"question_id": str(question.id), "choice_id": answer_key[str(question.id)]},
            ]},
        )
    csv_text = export_cards_csv(
        [{"id": cards[0]["id"], "front": "=HYPERLINK(\"https://evil\")", "back": "+SUM(1,1)", "tags": ["x"]}],
        lambda _card_id: {"source_quote": "@unsafe", "page": 1, "chapter_id": "chapter"},
    )
    assert "'=HYPERLINK" in csv_text and "'+SUM" in csv_text
    assert "\r\n" in csv_text
