"""Review replay returns its committed schedule and never advances it twice."""

import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from app.documents.pg_store import PgDocumentStore
from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.errors import InvalidInput, NotFound

NOW = datetime(2026, 11, 18, 12, tzinfo=UTC)
CARD = "11111111-1111-4111-8111-111111111111"
KEY = "22222222-2222-4222-8222-222222222222"


def store():
    docs = InMemoryDocumentStore()
    doc = docs.create(user_id="alice", filename="a.pdf", mime_type="application/pdf", size_bytes=1)
    docs.replace_structure(
        doc.id,
        [ChapterRecord("chapter", doc.id, "alice", "Chapter", 1, 1, 1)],
        [ChunkRecord("chunk", doc.id, "alice", "chapter", "Source passage supports the answer.", 1, 1)],
    )
    docs.add_flashcards(
        [
            {
                "id": CARD,
                "chapter_id": "chapter",
                "source_chunk_id": "chunk",
                "source_quote": "Source passage supports the answer.",
                "front": "Q?",
                "back": "A",
            }
        ],
        document_id=doc.id,
        user_id="alice",
        due_date="2026-11-18",
    )
    return docs


def test_concurrent_duplicate_reviews_have_one_effect_and_the_same_committed_result():
    docs = store()
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(
            pool.map(
                lambda _: docs.atomic_review(card_id=CARD, user_id="alice", grade=4, review_id=KEY, now=NOW), range(50)
            )
        )
    assert sum(not result["replayed"] for result in results) == 1
    assert len(docs._reviews) == 1
    assert docs.get_flashcard_for_user(CARD, "alice")["repetitions"] == 1
    assert all(result["due_date"] == "2026-11-19" and result["interval_days"] == 1 for result in results)


def test_duplicate_replays_original_schedule_even_after_another_review():
    docs = store()
    first = docs.atomic_review(card_id=CARD, user_id="alice", grade=4, review_id=KEY, now=NOW)
    second = docs.atomic_review(card_id=CARD, user_id="alice", grade=4, review_id=str(uuid.uuid4()), now=NOW)
    replay = docs.atomic_review(card_id=CARD, user_id="alice", grade=4, review_id=KEY, now=NOW)
    assert second["interval_days"] == 6
    assert replay == {**first, "replayed": True}
    assert docs.get_flashcard_for_user(CARD, "alice")["interval_days"] == 6


def test_memory_legacy_duplicate_freezes_current_schedule_without_advancing():
    docs = store()
    docs.add_review(card_id=CARD, user_id="alice", grade=4, client_review_id=KEY)
    docs.update_flashcard_sm2(CARD, ease=2.5, interval_days=1, reps=1, due="2026-11-19")
    replay = docs.atomic_review(card_id=CARD, user_id="alice", grade=4, review_id=KEY, now=NOW)
    assert replay["replayed"] and replay["repetitions"] == 1
    assert len(docs._reviews) == 1


def test_two_devices_with_distinct_keys_serialize_schedule_updates():
    docs = store()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda _: docs.atomic_review(
                    card_id=CARD, user_id="alice", grade=4, review_id=str(uuid.uuid4()), now=NOW
                ),
                range(2),
            )
        )
    assert sorted(result["interval_days"] for result in results) == [1, 6]
    assert docs.get_flashcard_for_user(CARD, "alice")["repetitions"] == 2


def test_reused_key_with_different_payload_is_rejected_and_owner_is_enforced():
    docs = store()
    docs.atomic_review(card_id=CARD, user_id="alice", grade=4, review_id=KEY, now=NOW)
    with pytest.raises(InvalidInput, match="another review"):
        docs.atomic_review(card_id=CARD, user_id="alice", grade=5, review_id=KEY, now=NOW)
    with pytest.raises(NotFound):
        docs.atomic_review(card_id=CARD, user_id="bob", grade=4, review_id=KEY, now=NOW)
    assert len(docs._reviews) == 1


@pytest.mark.parametrize("grade", [-1, 6, True, "4"])
def test_invalid_grade_never_mutates(grade):
    docs = store()
    with pytest.raises(InvalidInput):
        docs.atomic_review(card_id=CARD, user_id="alice", grade=grade, review_id=KEY, now=NOW)
    assert docs._reviews == []


def fake_pg(rows):
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchone.side_effect = rows
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value = cursor
    docs = PgDocumentStore.__new__(PgDocumentStore)
    docs._connect_for_atomic = MagicMock(return_value=connection)
    return docs, cursor, connection


def test_pg_uses_one_transaction_owner_card_locks_and_stores_result_before_schedule_update():
    docs, cur, conn = fake_pg([("alice",), (CARD, 2.5, 0, 0, "2026-11-18"), None, ("review",)])
    result = docs.atomic_review(card_id=CARD, user_id="alice", grade=4, review_id=KEY, now=NOW)
    conn.transaction.assert_called_once()
    queries = [call.args for call in cur.execute.call_args_list]
    assert "users WHERE id=%s FOR UPDATE" in queries[0][0] and queries[0][1] == ("alice",)
    assert "flashcards WHERE id=%s AND user_id=%s AND status='active' FOR UPDATE" in queries[1][0]
    assert queries[1][1] == (CARD, "alice")
    assert "WHERE user_id=%s AND client_review_id=%s" in queries[2][0]
    assert "INSERT INTO reviews" in queries[3][0]
    assert json.loads(queries[3][1][4]) == result
    assert "WHERE id=%s AND user_id=%s" in queries[4][0]
    assert queries[4][1][-2:] == (CARD, "alice")


def test_pg_duplicate_uses_stored_schedule_without_insert_or_update():
    saved = {
        "id": CARD,
        "ease_factor": 2.5,
        "interval_days": 1,
        "repetitions": 1,
        "due_date": "2026-11-19",
        "replayed": False,
    }
    docs, cur, _ = fake_pg([("alice",), (CARD, 2.5, 6, 2, "2026-11-24"), (CARD, 4, saved)])
    assert docs.atomic_review(card_id=CARD, user_id="alice", grade=4, review_id=KEY, now=NOW) == {
        **saved,
        "replayed": True,
    }
    assert len(cur.execute.call_args_list) == 3


def test_pg_legacy_duplicate_freezes_current_schedule_without_advancing():
    docs, cur, _ = fake_pg([("alice",), (CARD, 2.5, 6, 2, "2026-11-24"), (CARD, 4, None)])
    result = docs.atomic_review(card_id=CARD, user_id="alice", grade=4, review_id=KEY, now=NOW)
    assert result["replayed"] and result["interval_days"] == 6
    queries = [call.args[0] for call in cur.execute.call_args_list]
    assert not any("UPDATE flashcards" in query or "INSERT INTO reviews" in query for query in queries)
    assert "UPDATE reviews SET result" in queries[-1]


def test_pg_missing_or_other_owned_card_never_inserts_review():
    docs, cur, _ = fake_pg([("alice",), None])
    with pytest.raises(NotFound):
        docs.atomic_review(card_id=CARD, user_id="alice", grade=4, review_id=KEY, now=NOW)
    assert len(cur.execute.call_args_list) == 2


def test_missing_document_returns_none_instead_of_keyerror():
    docs = PgDocumentStore.__new__(PgDocumentStore)
    docs.get_internal = MagicMock(side_effect=KeyError("gone"))
    assert docs.get_for_user("gone", "alice") is None
