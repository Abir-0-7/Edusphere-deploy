"""Regeneration is a validated additive merge, never deletion of review history."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from app.documents.pg_store import PgDocumentStore
from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore, _source_revision
from app.errors import InvalidInput, NotFound

NOW = datetime(2026, 11, 18, tzinfo=UTC)


def fixture():
    docs = InMemoryDocumentStore()
    doc = docs.create(user_id="alice", filename="a.pdf", mime_type="application/pdf", size_bytes=1)
    docs.replace_structure(
        doc.id,
        [
            ChapterRecord("chapter", doc.id, "alice", "Topic", 1, 1, 1),
            ChapterRecord("other-chapter", doc.id, "alice", "Other", 2, 2, 2),
        ],
        [
            ChunkRecord("source", doc.id, "alice", "chapter", "Plants convert light into chemical energy.", 1, 1),
            ChunkRecord("other-source", doc.id, "alice", "other-chapter", "Other topic.", 2, 2),
        ],
    )
    card = {
        "id": "old",
        "chapter_id": "chapter",
        "source_chunk_id": "source",
        "front": "What is converted?",
        "back": "Light into chemical energy.",
    }
    docs.add_flashcards([card], document_id=doc.id, user_id="alice", due_date="2026-11-18")
    return docs, doc, card


def test_matching_generated_card_keeps_original_id_schedule_and_review_history():
    docs, doc, card = fixture()
    docs.atomic_review(
        card_id="old", user_id="alice", grade=4, review_id="11111111-1111-4111-8111-111111111111", now=NOW
    )
    before = dict(docs.get_flashcard_for_user("old", "alice"))
    assert (
        docs.merge_flashcards(
            [{**card, "id": "new", "front": " What is   converted? "}],
            document_id=doc.id,
            user_id="alice",
            due_date="2026-11-18",
        )
        == 1
    )
    assert docs.get_flashcard_for_user("old", "alice") == before
    assert docs.get_flashcard_for_user("new", "alice") is None
    assert len(docs._reviews) == 1


def test_edited_and_unmatched_old_cards_are_preserved_and_new_drafts_added_once():
    docs, doc, card = fixture()
    docs.get_flashcard_for_user("old", "alice")["back"] = "My edited explanation"
    generated = {**card, "id": "new"}
    assert (
        docs.merge_flashcards(
            [generated, {**generated, "id": "duplicate-draft"}],
            document_id=doc.id,
            user_id="alice",
            due_date="2026-11-18",
        )
        == 2
    )
    assert (
        docs.merge_flashcards(
            [{**generated, "id": "retry-generated-id"}], document_id=doc.id, user_id="alice", due_date="2026-11-18"
        )
        == 2
    )
    assert docs.get_flashcard_for_user("old", "alice")["back"] == "My edited explanation"
    assert {card["id"] for card in docs.list_flashcards(doc.id, "alice")} == {"old", "new"}


@pytest.mark.parametrize(
    "changed",
    [
        {"chapter_id": "another-owner-chapter"},
        {"source_chunk_id": "another-owner-source"},
        {"source_chunk_id": "other-source"},
        {"source_quote": "not in this document"},
        {"front": " "},
        {"back": []},
        {"chapter_id": []},
    ],
)
def test_invalid_draft_keeps_existing_deck_and_does_not_partially_add(changed):
    docs, doc, card = fixture()
    valid = {**card, "id": "valid", "front": "A different question?"}
    invalid = {**card, "id": "bad", **changed}
    with pytest.raises(InvalidInput):
        docs.merge_flashcards([valid, invalid], document_id=doc.id, user_id="alice", due_date="2026-11-18")
    assert [row["id"] for row in docs.list_flashcards(doc.id, "alice")] == ["old"]


def test_quote_requires_exact_source_text_and_rejects_altered_whitespace():
    docs, doc, card = fixture()
    with pytest.raises(InvalidInput, match="quote"):
        docs.merge_flashcards(
            [{**card, "id": "quoted", "front": "With quote?", "source_quote": "convert  light into chemical energy."}],
            document_id=doc.id,
            user_id="alice",
            due_date="2026-11-18",
        )
    assert len(docs.list_flashcards(doc.id, "alice")) == 1


def test_another_owner_cannot_merge_and_id_collision_never_overwrites_old_content():
    docs, doc, card = fixture()
    with pytest.raises(NotFound):
        docs.merge_flashcards([card], document_id=doc.id, user_id="bob", due_date="2026-11-18")
    with pytest.raises(InvalidInput, match="id is already"):
        docs.merge_flashcards(
            [{**card, "front": "Changed under same id?"}], document_id=doc.id, user_id="alice", due_date="2026-11-18"
        )
    assert docs.get_flashcard_for_user("old", "alice")["front"] == card["front"]


def test_concurrent_identical_generations_add_one_card_content():
    docs, doc, card = fixture()
    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(
            pool.map(
                lambda n: docs.merge_flashcards(
                    [{**card, "id": f"new-{n}", "front": "New distinct question?"}],
                    document_id=doc.id,
                    user_id="alice",
                    due_date="2026-11-18",
                ),
                range(30),
            )
        )
    assert set(results) == {2}
    assert len(docs.list_flashcards(doc.id, "alice")) == 2


def fake_pg(*, first_rows=None):
    cur = MagicMock()
    cur.__enter__.return_value = cur
    document = ("doc", "alice", "notes.pdf", "application/pdf", 1, 1, "parsed", None, None)
    cur.fetchone.side_effect = first_rows or [("alice",), document, (1,), (2,)]
    cur.fetchall.side_effect = [
        [("chapter", "doc", "alice", "Topic", 1, 1, 1)],
        [("source", "doc", "alice", "chapter", "Source passage.", 1, 1)],
        [("old", "chapter", "source", "Old question?", "Old answer.")],
    ]
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value = cur
    docs = PgDocumentStore.__new__(PgDocumentStore)
    docs._connect_for_atomic = MagicMock(return_value=conn)
    docs._max_flashcards_per_deck = 2000
    return docs, cur, conn


def test_pg_merge_locks_owned_source_and_adds_without_delete_or_update_old_cards():
    docs, cur, conn = fake_pg()
    draft = {
        "id": "new",
        "chapter_id": "chapter",
        "source_chunk_id": "source",
        "front": "New question?",
        "back": "New answer.",
    }
    assert docs.merge_flashcards([draft], document_id="doc", user_id="alice", due_date="2026-11-18") == 2
    conn.transaction.assert_called_once()
    queries = [call.args for call in cur.execute.call_args_list]
    assert "users WHERE id=%s FOR UPDATE" in queries[0][0]
    assert "documents WHERE id=%s AND user_id=%s FOR UPDATE" in queries[1][0]
    assert all("user_id=%s" in query for query, _ in queries[1:6])
    insert = next(query for query in queries if "INSERT INTO flashcards" in query[0])
    assert insert[1] == (
        "new",
        "doc",
        "chapter",
        "source",
        "alice",
        "New question?",
        "New answer.",
        "Source passage.",
        _source_revision("doc", "chapter", "source", "Source passage.", "Source passage."),
        "2026-11-18",
        "[]",
    )
    assert not any("DELETE" in sql or "UPDATE flashcards" in sql for sql, _ in queries)


def test_pg_merge_with_identical_content_ignores_draft_id_and_keeps_old_id():
    docs, cur, _ = fake_pg(first_rows=[
        ("alice",), ("doc", "alice", "notes.pdf", "application/pdf", 1, 1, "parsed", None, None), (1,), (1,),
    ])
    draft = {
        "id": "generated-id",
        "chapter_id": "chapter",
        "source_chunk_id": "source",
        "front": "Old question?",
        "back": "Old answer.",
    }
    assert docs.merge_flashcards([draft], document_id="doc", user_id="alice", due_date="2026-11-18") == 1
    assert not any("INSERT" in call.args[0] for call in cur.execute.call_args_list)
