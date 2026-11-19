"""Flashcard Studio repositories keep previews private until explicit merge."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest

from app.documents.pg_store import PgDocumentStore
from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore, _source_revision
from app.errors import InvalidInput, NotFound
from app.flashcard_studio.contracts import (
    DraftCard,
    GenerationDraft,
    GenerationSettings,
    MergeDraftRequest,
    ReplaceCard,
)
from app.flashcard_studio.source import source_revision
from app.flashcard_studio.store import MemoryFlashcardStudioStore, PgFlashcardStudioStore


@pytest.fixture()
def studio_fixture():
    documents = InMemoryDocumentStore()
    doc = documents.create(user_id="alice", filename="plant.pdf", mime_type="application/pdf", size_bytes=20)
    chapter_id, chunk_id = str(uuid4()), str(uuid4())
    chapter = ChapterRecord(chapter_id, doc.id, "alice", "Photosynthesis", 1, 1, 1)
    chunk = ChunkRecord(
        chunk_id, doc.id, "alice", chapter_id, "Plants convert light energy into stored chemical energy.", 1, 1
    )
    documents.replace_structure(doc.id, [chapter], [chunk])
    settings = GenerationSettings(
        chapter_ids=[UUID(chapter_id)],
        language="en",
        difficulty="basic",
        count=4,
    )
    revision = source_revision(doc, settings)
    cards = [
        DraftCard(
            id=uuid4(),
            chapter_id=UUID(chapter_id),
            source_chunk_id=UUID(chunk_id),
            source_quote="convert light energy into stored chemical energy",
            page=1,
            front="What do plants convert?",
            back="Light energy into stored chemical energy.",
        ),
        DraftCard(
            id=uuid4(),
            chapter_id=UUID(chapter_id),
            source_chunk_id=UUID(chunk_id),
            source_quote="Plants convert light energy",
            page=1,
            front="What is stored?",
            back="Chemical energy.",
        ),
    ]
    draft = GenerationDraft(id=uuid4(), source_revision=revision, settings=settings, cards=cards)
    return documents, doc, MemoryFlashcardStudioStore(documents), draft


def test_draft_is_private_and_save_retry_is_idempotent(studio_fixture):
    documents, doc, store, draft = studio_fixture
    store.save_draft(doc.id, "alice", draft)
    store.save_draft(doc.id, "alice", draft)

    assert store.get_draft(doc.id, "alice", str(draft.id)) == draft
    assert documents.list_flashcards(doc.id, "alice") == []
    with pytest.raises(NotFound):
        store.get_draft(doc.id, "bob", str(draft.id))
    with pytest.raises(NotFound):
        store.get_draft(doc.id, "alice", str(uuid4()))


def test_save_draft_rejects_unquoted_or_stale_evidence_without_writing(studio_fixture):
    documents, doc, store, draft = studio_fixture
    bad_card = draft.cards[0].model_copy(update={"source_quote": "text from a different document"})
    bad = draft.model_copy(update={"cards": [bad_card, draft.cards[1]]})
    with pytest.raises(InvalidInput):
        store.save_draft(doc.id, "alice", bad)
    assert documents.list_flashcards(doc.id, "alice") == []

    documents.replace_structure(
        doc.id,
        [ChapterRecord(draft.settings.chapter_ids[0].__str__(), doc.id, "alice", "Revised", 1, 1, 1)],
        doc.chunks,
    )
    with pytest.raises(InvalidInput, match="Source changed"):
        store.save_draft(doc.id, "alice", draft)
    with pytest.raises(NotFound):
        store.get_draft(doc.id, "alice", str(draft.id))


def test_source_change_after_preview_blocks_merge(studio_fixture):
    documents, doc, store, draft = studio_fixture
    store.save_draft(doc.id, "alice", draft)
    doc.chunks[0].content += " New material."

    with pytest.raises(InvalidInput, match="source changed"):
        store.merge_draft(doc.id, "alice", str(draft.id), MergeDraftRequest(card_ids=[draft.cards[0].id]))
    assert documents.list_flashcards(doc.id, "alice") == []


def test_merge_adds_only_selected_card_and_retry_cannot_change_selection(studio_fixture):
    documents, doc, store, draft = studio_fixture
    store.save_draft(doc.id, "alice", draft)
    selected = [draft.cards[1].id]

    result = store.merge_draft(doc.id, "alice", str(draft.id), MergeDraftRequest(card_ids=selected))
    replay = store.merge_draft(doc.id, "alice", str(draft.id), MergeDraftRequest(card_ids=selected))

    assert result == replay
    cards = documents.list_flashcards(doc.id, "alice")
    assert len(cards) == 1
    assert cards[0]["id"] == str(selected[0])
    assert cards[0]["source_quote"] == draft.cards[1].source_quote
    assert cards[0]["source_revision"] == _source_revision(
        doc.id, str(draft.cards[1].chapter_id), str(draft.cards[1].source_chunk_id),
        doc.chunks[0].content, draft.cards[1].source_quote,
    )
    assert documents.get_flashcard_source_for_user(cards[0]["id"], "alice") is not None
    doc.chunks[0].content += " Source changed after the card was saved."
    assert documents.get_flashcard_source_for_user(cards[0]["id"], "alice") is None
    assert cards[0]["ease_factor"] == 2.5
    assert store.list_decks(doc.id, "alice")[0].card_count == 1
    with pytest.raises(InvalidInput, match="already merged"):
        store.merge_draft(doc.id, "alice", str(draft.id), MergeDraftRequest(card_ids=[draft.cards[0].id]))
    with pytest.raises(InvalidInput, match="already merged"):
        store.merge_draft(doc.id, "alice", str(draft.id), MergeDraftRequest(card_ids=selected, deck_name="Other"))


def test_concurrent_same_merge_request_adds_once(studio_fixture):
    documents, doc, store, draft = studio_fixture
    store.save_draft(doc.id, "alice", draft)
    request = MergeDraftRequest(card_ids=[draft.cards[0].id])

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: store.merge_draft(doc.id, "alice", str(draft.id), request), range(24)))

    assert all(result == results[0] for result in results)
    assert results[0].added_count == 1
    assert [row["id"] for row in documents.list_flashcards(doc.id, "alice")] == [str(draft.cards[0].id)]
    assert store.get_draft(doc.id, "alice", str(draft.id)).merge_result == results[0]


def test_merge_over_deck_limit_does_not_publish_partial_cards_or_versions(studio_fixture):
    documents, doc, store, draft = studio_fixture
    documents._max_flashcards_per_deck = 1
    store.save_draft(doc.id, "alice", draft)

    with pytest.raises(InvalidInput, match="deck limit"):
        store.merge_draft(
            doc.id, "alice", str(draft.id), MergeDraftRequest(card_ids=[card.id for card in draft.cards])
        )

    assert documents.list_flashcards(doc.id, "alice") == []
    assert documents._flashcard_versions == {}
    assert store.get_draft(doc.id, "alice", str(draft.id)).merge_result is None


def test_merge_ignores_matching_question_without_touching_reviewed_card(studio_fixture):
    documents, doc, store, draft = studio_fixture
    old = {
        "id": str(uuid4()),
        "chapter_id": str(draft.cards[0].chapter_id),
        "source_chunk_id": str(draft.cards[0].source_chunk_id),
        "front": " What   do plants convert? ",
        "back": "Learner's reviewed answer.",
    }
    documents.add_flashcards([old], document_id=doc.id, user_id="alice", due_date="2026-11-18")
    documents.atomic_review(
        card_id=old["id"],
        user_id="alice",
        grade=4,
        review_id="a57fbc00-e11e-482f-b8b5-3ec136b9b01a",
        now=datetime(2026, 11, 18, tzinfo=UTC),
    )
    before = dict(documents.get_flashcard_for_user(old["id"], "alice"))
    store.save_draft(doc.id, "alice", draft)

    result = store.merge_draft(doc.id, "alice", str(draft.id), MergeDraftRequest(card_ids=[draft.cards[0].id]))

    assert result.added_count == 0
    after = documents.get_flashcard_for_user(old["id"], "alice")
    assert after == before
    assert len(documents._reviews) == 1
    assert len(documents.list_flashcards(doc.id, "alice")) == 1
    default = store.list_decks(doc.id, "alice")[0]
    assert default.is_default is True and default.card_count == 1


def test_named_deck_is_separate_and_same_question_dedupes_only_within_deck(studio_fixture):
    documents, doc, store, draft = studio_fixture
    store.save_draft(doc.id, "alice", draft)
    request = MergeDraftRequest(card_ids=[card.id for card in draft.cards], deck_name="Exam 1")

    first = store.merge_draft(doc.id, "alice", str(draft.id), request)
    assert first.added_count == 2
    assert len(documents.list_flashcards(doc.id, "alice")) == 2
    summary = store.list_decks(doc.id, "alice")
    named = next(deck for deck in summary if deck.name == "Exam 1")
    default = next(deck for deck in summary if deck.is_default)
    assert named.card_count == 2
    assert default.card_count == 0


def test_selected_regeneration_preserves_card_id_history_and_schedule(studio_fixture):
    documents, doc, store, draft = studio_fixture
    original = {
        "id": str(uuid4()),
        "chapter_id": str(draft.cards[0].chapter_id),
        "source_chunk_id": str(draft.cards[0].source_chunk_id),
        "front": "What do plants convert?",
        "back": "My edited answer.",
        "tags": ["exam"],
    }
    documents.add_flashcards([original], document_id=doc.id, user_id="alice", due_date="2026-12-01")
    store.list_decks(doc.id, "alice")
    documents.atomic_review(
        card_id=original["id"],
        user_id="alice",
        grade=4,
        review_id="d57fbc00-e11e-482f-b8b5-3ec136b9b01a",
        now=datetime(2026, 11, 18, tzinfo=UTC),
    )
    before = dict(documents.get_flashcard_for_user(original["id"], "alice"))
    store.save_draft(doc.id, "alice", draft)
    request = MergeDraftRequest(
        card_ids=[draft.cards[0].id],
        replacements=[ReplaceCard(card_id=UUID(original["id"]), draft_card_id=draft.cards[0].id)],
    )

    result = store.merge_draft(doc.id, "alice", str(draft.id), request)
    replay = store.merge_draft(doc.id, "alice", str(draft.id), request)

    updated = documents.get_flashcard_for_user(original["id"], "alice")
    assert result == replay and result.updated_count == 1 and result.added_count == 0
    assert updated["id"] == before["id"]
    assert updated["front"] == draft.cards[0].front and updated["back"] == draft.cards[0].back
    assert updated["repetitions"] == before["repetitions"]
    assert updated["ease_factor"] == before["ease_factor"]
    assert updated["tags"] == ["exam"]
    assert updated["needs_review"] is True
    assert len(documents._reviews) == 1
    assert [version["version"] for version in documents._flashcard_versions[original["id"]]] == [1, 2]
    saved_draft = store.get_draft(doc.id, "alice", str(draft.id))
    assert saved_draft.merge_result is not None and saved_draft.merge_result.updated_count == 1


def test_partial_selected_regeneration_replaces_mapped_card_and_adds_unmapped_candidate(studio_fixture):
    documents, doc, store, draft = studio_fixture
    original = {
        "id": str(uuid4()),
        "chapter_id": str(draft.cards[0].chapter_id),
        "source_chunk_id": str(draft.cards[0].source_chunk_id),
        "front": "What do plants convert?",
        "back": "An older answer.",
    }
    documents.add_flashcards([original], document_id=doc.id, user_id="alice", due_date="2026-12-01")
    store.list_decks(doc.id, "alice")
    store.save_draft(doc.id, "alice", draft)
    request = MergeDraftRequest(
        card_ids=[card.id for card in draft.cards],
        replacements=[ReplaceCard(card_id=UUID(original["id"]), draft_card_id=draft.cards[0].id)],
    )

    result = store.merge_draft(doc.id, "alice", str(draft.id), request)

    assert result.added_count == 1 and result.updated_count == 1
    saved = documents.list_flashcards(doc.id, "alice")
    assert {row["id"] for row in saved} == {original["id"], str(draft.cards[1].id)}
    assert documents.get_flashcard_for_user(original["id"], "alice")["front"] == draft.cards[0].front
    assert documents.get_flashcard_for_user(str(draft.cards[1].id), "alice")["back"] == draft.cards[1].back


def test_pg_source_snapshot_locks_owner_then_document_before_children(studio_fixture):
    _, doc, _, draft = studio_fixture
    user_id = doc.user_id
    chapter = doc.chapters[0]
    chunk = doc.chunks[0]
    cur = MagicMock()
    cur.fetchone.side_effect = [
        (user_id,),
        (doc.id, user_id, "plant.pdf", "application/pdf", 20, 1, "parsed", None, None),
    ]
    cur.fetchall.side_effect = [
        [(chapter.id, doc.id, user_id, chapter.title, chapter.ordinal, chapter.start_page, chapter.end_page)],
        [(chunk.id, doc.id, user_id, chunk.chapter_id, chunk.content, chunk.page, chunk.ordinal)],
    ]

    source = PgFlashcardStudioStore._load_source(cur, doc.id, user_id)

    statements = [call.args[0] for call in cur.execute.call_args_list]
    assert "users WHERE id=%s FOR KEY SHARE" in statements[0]
    assert "documents WHERE id=%s AND user_id=%s FOR UPDATE" in statements[1]
    assert "chapters" in statements[2] and "FOR SHARE" in statements[2]
    assert "chunks" in statements[3] and "FOR SHARE" in statements[3]
    assert source_revision(source, draft.settings) == draft.source_revision


def test_pg_structure_replacement_locks_owner_and_document_before_deleting_chunks():
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [("owner",), ("owner",), ("document",)]
    connection = MagicMock()
    connection.cursor.return_value = cursor
    store = PgDocumentStore.__new__(PgDocumentStore)
    store._conn = connection
    store._max_chunks_per_document = 100

    store.replace_structure("document", [], [])

    sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert "SELECT user_id FROM documents" in sql[0]
    assert "users WHERE id=%s FOR KEY SHARE" in sql[1]
    assert "documents WHERE id=%s AND user_id=%s FOR UPDATE" in sql[2]
    assert sql[3].startswith("DELETE FROM chunks")


def test_pg_merge_writes_validated_selected_cards_in_same_transaction(studio_fixture):
    _, doc, _, draft = studio_fixture
    user_id = str(uuid4())
    source_doc = deepcopy(doc)
    source_doc.user_id = user_id
    for chapter in source_doc.chapters:
        chapter.user_id = user_id
    for chunk in source_doc.chunks:
        chunk.user_id = user_id
    revision = source_revision(source_doc, draft.settings)
    card = draft.cards[0]
    deck_id = str(uuid4())
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [
        (user_id,),
        (doc.id, user_id, "plant.pdf", "application/pdf", 20, 1, "parsed", None, None),
        (
            revision,
            draft.settings.model_dump(mode="json"),
            [item.model_dump(mode="json") for item in draft.cards],
            None,
            None,
        ),
        (deck_id, "Default"),
        (False,),
        (str(card.id),),
    ]
    cursor.fetchall.side_effect = [
        [(doc.chapters[0].id, doc.id, user_id, doc.chapters[0].title, 1, 1, 1)],
        [(doc.chunks[0].id, doc.id, user_id, doc.chunks[0].chapter_id, doc.chunks[0].content, 1, 1)],
        [],
    ]
    cursor.rowcount = 1
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value = cursor
    store = PgFlashcardStudioStore.__new__(PgFlashcardStudioStore)
    store._database_url = "postgresql://not-used-in-unit-test"
    store._max_flashcards_per_deck = 2000
    store._lock = threading.RLock()
    store._connect_for_atomic = MagicMock(return_value=connection)

    result = store.merge_draft(doc.id, user_id, str(draft.id), MergeDraftRequest(card_ids=[card.id]))

    assert result.deck_id == UUID(deck_id) and result.added_count == 1
    connection.transaction.assert_called_once()
    statements = [call.args for call in cursor.execute.call_args_list]
    insert = next(call for call in statements if "INSERT INTO flashcards" in call[0])
    assert insert[1] == (
        str(card.id),
        doc.id,
        deck_id,
        str(card.chapter_id),
        str(card.source_chunk_id),
        card.source_quote,
        _source_revision(
            source_doc.id, str(card.chapter_id), str(card.source_chunk_id),
            source_doc.chunks[0].content, card.source_quote,
        ),
        user_id,
        card.front,
        card.back,
        insert[1][10],
    )
    assert len(insert[1][10]) == 10
    save_merge = next(call for call in statements if "UPDATE flashcard_generation_drafts SET merge_result" in call[0])
    assert json.loads(save_merge[1][0]) == {"deck_id": deck_id, "added_count": 1, "updated_count": 0}
    assert json.loads(save_merge[1][1]) == {
        "card_ids": [str(card.id)],
        "deck_name": "Default",
        "is_default": True,
        "replacements": [],
    }
