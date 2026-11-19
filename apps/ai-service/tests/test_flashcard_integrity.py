"""Stable flashcard identity, review replay, and source evidence checks."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest

from app.ai.flashcards import _parse_cards
from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.errors import InvalidInput, NotFound

NOW = datetime(2026, 11, 18, 12, tzinfo=UTC)
CARD_ID = "11111111-1111-4111-8111-111111111111"
REVIEW_ID = "22222222-2222-4222-8222-222222222222"


def fixture():
    store = InMemoryDocumentStore()
    doc = store.create(user_id="alice", filename="notes.pdf", mime_type="application/pdf", size_bytes=1)
    chapter = ChapterRecord("chapter", doc.id, "alice", "Photosynthesis", 1, 1, 1)
    chunk = ChunkRecord("chunk", doc.id, "alice", "chapter", "Plants convert light into chemical energy.", 1, 1)
    store.replace_structure(doc.id, [chapter], [chunk])
    card = {
        "id": CARD_ID,
        "chapter_id": chapter.id,
        "source_chunk_id": chunk.id,
        "source_quote": "Plants convert light into chemical energy.",
        "front": "What do plants convert?",
        "back": "Light into chemical energy.",
    }
    return store, doc, card


def test_additive_retry_preserves_stable_id_review_schedule_and_evidence():
    store, doc, card = fixture()
    assert store.merge_flashcards([card], document_id=doc.id, user_id="alice", due_date="2026-11-18") == 1
    initial = dict(store.get_flashcard_for_user(CARD_ID, "alice"))
    first = store.atomic_review(card_id=CARD_ID, user_id="alice", grade=4, review_id=REVIEW_ID, now=NOW)
    reviewed = dict(store.get_flashcard_for_user(CARD_ID, "alice"))

    assert store.merge_flashcards([card], document_id=doc.id, user_id="alice", due_date="2026-11-18") == 1
    assert store.get_flashcard_for_user(CARD_ID, "alice") == reviewed
    assert store.atomic_review(card_id=CARD_ID, user_id="alice", grade=4, review_id=REVIEW_ID, now=NOW) == {
        **first,
        "replayed": True,
    }
    assert store.get_flashcard_source_for_user(CARD_ID, "alice")["source_quote"] == card["source_quote"]
    assert initial["id"] == reviewed["id"] and len(store._reviews) == 1


def test_source_quote_must_be_owned_by_exact_chapter_chunk_and_revision():
    store, doc, card = fixture()
    invalid = {**card, "source_quote": "a fabricated quote"}
    with pytest.raises(InvalidInput, match="quote"):
        store.add_flashcards([invalid], document_id=doc.id, user_id="alice", due_date="2026-11-18")
    with pytest.raises(NotFound):
        store.add_flashcards([card], document_id=doc.id, user_id="mallory", due_date="2026-11-18")

    store.merge_flashcards([card], document_id=doc.id, user_id="alice", due_date="2026-11-18")
    document = store.get_internal(doc.id)
    document.chunks[0].content = "The source was replaced after the card was generated."
    assert store.get_flashcard_source_for_user(CARD_ID, "alice") is None


def test_two_devices_with_duplicate_review_key_apply_schedule_once():
    store, doc, card = fixture()
    store.add_flashcards([card], document_id=doc.id, user_id="alice", due_date="2026-11-18")
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(
            pool.map(
                lambda _: store.atomic_review(card_id=CARD_ID, user_id="alice", grade=4, review_id=REVIEW_ID, now=NOW),
                range(12),
            )
        )
    assert sum(not result["replayed"] for result in results) == 1
    assert store.get_flashcard_for_user(CARD_ID, "alice")["repetitions"] == 1
    assert len(store._reviews) == 1


def test_same_generated_content_reuses_card_id_and_pins_exact_source():
    store, document, _ = fixture()
    chapter = document.chapters[0]
    chunks = document.chunks
    raw = '{"cards":[{"front":"What do plants convert?","back":"Light into chemical energy."}]}'
    first = _parse_cards(raw, chapter, chunks)[0]
    retry = _parse_cards(raw, chapter, chunks)[0]
    assert first.id == retry.id
    assert first.source_quote in chunks[0].content
    assert len(first.source_revision) == 64
