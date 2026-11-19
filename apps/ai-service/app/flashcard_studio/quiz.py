"""Deterministic quiz building, protected grading, and safe CSV exports."""

import csv
import hashlib
import io
import json
import threading
import unicodedata
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID, uuid4, uuid5

from app.errors import Conflict, InvalidInput, NotFound
from app.flashcard_studio.quiz_contracts import (
    QuizGradeRequest,
    QuizGradeResult,
    QuizQuestion,
    QuizSession,
)

MAX_QUIZ_COUNT = 20
MAX_EXPORT_CARDS = 2000


def _normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def _seeded_order(seed: str, values: list[str]) -> list[str]:
    return sorted(values, key=lambda value: hashlib.sha256(f"{seed}:{value}".encode()).digest())


def build_quiz(
    *,
    document_id: str,
    deck_id: str,
    cards: list[dict[str, Any]],
    source_for_card: Callable[[str], dict[str, Any] | None],
    count: int,
) -> tuple[QuizSession, dict[str, dict[str, Any]]]:
    """Build a reproducible multiple-choice quiz using only validated saved cards."""
    if type(count) is not int or not 1 <= count <= MAX_QUIZ_COUNT:
        raise InvalidInput("Quiz count must be from 1 to 20")
    session_id = uuid4()
    eligible: list[dict[str, Any]] = []
    for card in cards:
        card_id = str(card.get("id", ""))
        source = source_for_card(card_id)
        if not source or not isinstance(source.get("source_quote"), str):
            continue
        front, back, quote = card.get("front"), card.get("back"), source.get("source_quote")
        if (
            not all(isinstance(value, str) and value.strip() for value in (front, back, quote))
            or len(front) > 300
            or len(back) > 600
            or len(quote) > 1600
        ):
            continue
        page = source.get("page")
        if type(page) is not int or page < 1:
            page = None
        eligible.append({**card, "source_quote": quote, "page": page})

    # A distractor must be distinct from the answer and from other choices.
    answers_by_key = {_normalized(card["back"]): card for card in eligible}
    candidates = list(answers_by_key.values())
    if len(candidates) < 2:
        raise InvalidInput("This deck needs at least two source-supported cards with distinct answers")

    question_cards = _seeded_order(str(session_id), [str(card["id"]) for card in candidates])
    candidate_by_id = {str(card["id"]): card for card in candidates}
    selected = [candidate_by_id[card_id] for card_id in question_cards[: min(count, len(candidates))]]
    questions: list[QuizQuestion] = []
    answer_key: dict[str, dict[str, Any]] = {}
    all_candidate_ids = [str(card["id"]) for card in candidates]
    for card in selected:
        card_id = str(card["id"])
        question_id = uuid5(session_id, f"question:{card_id}")
        distractor_ids = [candidate_id for candidate_id in all_candidate_ids if candidate_id != card_id]
        distractor_ids = _seeded_order(f"{session_id}:{question_id}", distractor_ids)[:3]
        option_ids = [card_id, *distractor_ids]
        option_ids = _seeded_order(f"options:{session_id}:{question_id}", option_ids)
        choices = []
        correct_choice_id = None
        for option_card_id in option_ids:
            choice_id = uuid5(question_id, f"choice:{option_card_id}")
            choices.append({"id": choice_id, "text": candidate_by_id[option_card_id]["back"]})
            if option_card_id == card_id:
                correct_choice_id = str(choice_id)
        questions.append(
            QuizQuestion(
                id=question_id,
                prompt=card["front"],
                choices=choices,
            )
        )
        if correct_choice_id is None:
            raise InvalidInput("Quiz option generation failed")
        answer_key[str(question_id)] = {
            "choice_id": correct_choice_id,
            "source_quote": card["source_quote"],
            "page": card.get("page"),
        }
    return (
        QuizSession(
            id=session_id,
            document_id=UUID(document_id),
            deck_id=UUID(deck_id),
            questions=questions,
        ),
        answer_key,
    )


def grade_answers(
    session_id: str,
    questions: list[dict[str, Any]],
    answer_key: dict[str, dict[str, Any]],
    request: QuizGradeRequest | dict[str, Any],
) -> QuizGradeResult:
    try:
        parsed = request if isinstance(request, QuizGradeRequest) else QuizGradeRequest.model_validate(request)
    except Exception as exc:
        raise InvalidInput("Quiz answers are invalid") from exc
    question_map = {str(question["id"]): question for question in questions}
    submitted: dict[str, str] = {}
    for answer in parsed.answers:
        question_id = str(answer.question_id)
        choice_id = str(answer.choice_id)
        question = question_map.get(question_id)
        allowed = {str(choice["id"]) for choice in question.get("choices", [])} if question else set()
        if question is None or question_id in submitted or choice_id not in allowed:
            raise InvalidInput("Quiz answer refers to an unknown or repeated choice")
        submitted[question_id] = choice_id
    if set(answer_key) != set(question_map):
        raise InvalidInput("Quiz answer key is incomplete")
    correct = sum(answer_key[question_id].get("choice_id") == choice_id for question_id, choice_id in submitted.items())
    total = len(questions)
    return QuizGradeResult(
        session_id=UUID(session_id),
        answered=len(submitted),
        correct=correct,
        total=total,
        percent=round(correct * 100 / total),
        feedback=[
            {
                "question_id": question_id,
                "answered": question_id in submitted,
                "correct": (
                    question_id in submitted
                    and answer_key[question_id].get("choice_id") == submitted[question_id]
                ),
                "source_quote": answer_key[question_id]["source_quote"],
                "page": answer_key[question_id].get("page"),
            }
            for question_id in question_map
        ],
    )


class QuizSessionStore(Protocol):
    def create(self, user_id: str, session: QuizSession, answer_key: dict[str, dict[str, Any]]) -> None: ...
    def get(self, user_id: str, session_id: str) -> dict[str, Any]: ...
    def grade(self, user_id: str, session_id: str, request: QuizGradeRequest) -> QuizGradeResult: ...


class MemoryQuizSessionStore:
    """Lock-protected owner-scoped session store for local/test configurations."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[tuple[str, str], dict[str, Any]] = {}

    def create(self, user_id: str, session: QuizSession, answer_key: dict[str, dict[str, Any]]) -> None:
        key = (user_id, str(session.id))
        with self._lock:
            self._sessions[key] = {
                "session": session.model_dump(mode="json"),
                "answer_key": dict(answer_key),
                "submitted": None,
                "result": None,
            }

    def get(self, user_id: str, session_id: str) -> dict[str, Any]:
        try:
            session_id = str(UUID(session_id))
        except ValueError as exc:
            raise NotFound("Quiz session not found") from exc
        with self._lock:
            saved = self._sessions.get((user_id, session_id))
            if saved is None:
                raise NotFound("Quiz session not found")
            return {"session": QuizSession.model_validate(saved["session"]), "result": saved["result"]}

    def grade(self, user_id: str, session_id: str, request: QuizGradeRequest) -> QuizGradeResult:
        key = (user_id, str(UUID(session_id)))
        with self._lock:
            saved = self._sessions.get(key)
            if saved is None:
                raise NotFound("Quiz session not found")
            session = saved["session"]
            # Validate the full submission before comparing replay state. Otherwise
            # duplicate answers could collapse into the same mapping and replay.
            result = grade_answers(session_id, session["questions"], saved["answer_key"], request)
            submitted = _canonical_submission(request)
            if saved["submitted"] is not None:
                if saved["submitted"] != submitted:
                    raise Conflict("This quiz session was already graded")
                return QuizGradeResult.model_validate(saved["result"])
            saved["submitted"] = submitted
            saved["result"] = result.model_dump(mode="json")
            return result


class PgQuizSessionStore:
    """Postgres store; owner, source document and deck are constrained in SQL."""

    def __init__(self, database_url: str) -> None:
        import psycopg

        self._database_url = database_url
        self._conn = psycopg.connect(database_url, autocommit=True, connect_timeout=5)

    def _connect(self):
        import psycopg

        return psycopg.connect(self._database_url, autocommit=True, connect_timeout=5)

    def create(self, user_id: str, session: QuizSession, answer_key: dict[str, dict[str, Any]]) -> None:
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "INSERT INTO flashcard_quiz_sessions "
                "(id,user_id,document_id,deck_id,questions,answer_key) "
                "SELECT %s,d.user_id,d.document_id,d.id,%s::jsonb,%s::jsonb "
                "FROM flashcard_decks AS d WHERE d.id=%s AND d.document_id=%s AND d.user_id=%s",
                (
                    str(session.id),
                    json.dumps([question.model_dump(mode="json") for question in session.questions]),
                    json.dumps(answer_key), str(session.deck_id), str(session.document_id), user_id,
                ),
            )
            if cur.rowcount != 1:
                raise NotFound("Source deck not found")

    def get(self, user_id: str, session_id: str) -> dict[str, Any]:
        try:
            session_id = str(UUID(session_id))
        except ValueError as exc:
            raise NotFound("Quiz session not found") from exc
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id,document_id,deck_id,questions,result FROM flashcard_quiz_sessions "
                "WHERE id=%s AND user_id=%s",
                (session_id, user_id),
            )
            row = cur.fetchone()
        if row is None:
            raise NotFound("Quiz session not found")
        questions = row[3] if isinstance(row[3], list) else json.loads(row[3])
        return {
            "session": QuizSession(id=row[0], document_id=row[1], deck_id=row[2], questions=questions),
            "result": row[4] if not isinstance(row[4], str) or row[4] is None else json.loads(row[4]),
        }

    def grade(self, user_id: str, session_id: str, request: QuizGradeRequest) -> QuizGradeResult:
        try:
            session_id = str(UUID(session_id))
        except ValueError as exc:
            raise NotFound("Quiz session not found") from exc
        with self._connect() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "SELECT questions,answer_key,submitted_answers,result FROM flashcard_quiz_sessions "
                "WHERE id=%s AND user_id=%s FOR UPDATE",
                (session_id, user_id),
            )
            row = cur.fetchone()
            if row is None:
                raise NotFound("Quiz session not found")
            questions = row[0] if isinstance(row[0], list) else json.loads(row[0])
            answer_key = row[1] if isinstance(row[1], dict) else json.loads(row[1])
            existing = row[2] if isinstance(row[2], dict) or row[2] is None else json.loads(row[2])
            result = grade_answers(session_id, questions, answer_key, request)
            submitted = _canonical_submission(request)
            if existing is not None:
                if existing != submitted:
                    raise Conflict("This quiz session was already graded")
                result = row[3] if isinstance(row[3], dict) else json.loads(row[3])
                return QuizGradeResult.model_validate(result)
            cur.execute(
                "UPDATE flashcard_quiz_sessions SET submitted_answers=%s::jsonb,result=%s::jsonb,graded_at=%s "
                "WHERE id=%s AND user_id=%s",
                (
                    json.dumps(submitted), json.dumps(result.model_dump(mode="json")), datetime.now(UTC),
                    session_id, user_id,
                ),
            )
            return result


def _safe_csv_cell(value: Any) -> str:
    text = "" if value is None else str(value)
    # Spreadsheet apps may ignore leading whitespace/control characters before a formula.
    index = 0
    while index < len(text) and (text[index].isspace() or unicodedata.category(text[index]).startswith("C")):
        index += 1
    if index < len(text) and text[index] in "=+-@":
        return "'" + text
    return text


def export_cards_csv(cards: list[dict[str, Any]], source_for_card: Callable[[str], dict[str, Any] | None]) -> str:
    """Serialize bounded source-linked cards as CSV with formula-prefix escaping."""
    if len(cards) > MAX_EXPORT_CARDS:
        raise InvalidInput("Deck is too large to export in one CSV")
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(("front", "back", "source_quote", "page", "chapter_id", "tags"))
    for card in cards:
        source = source_for_card(str(card.get("id", ""))) or {}
        writer.writerow(
            _safe_csv_cell(value)
            for value in (
                card.get("front"), card.get("back"), source.get("source_quote"), source.get("page"),
                source.get("chapter_id"), json.dumps(card.get("tags", []), ensure_ascii=False),
            )
        )
    return stream.getvalue()


def _canonical_submission(request: QuizGradeRequest) -> dict[str, str]:
    return {
        str(answer.question_id): str(answer.choice_id)
        for answer in sorted(request.answers, key=lambda item: str(item.question_id))
    }

