import pytest

from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.errors import InvalidInput
from app.pipeline import make_embed_handler


def _document(store: InMemoryDocumentStore, user_id: str = "alice"):
    doc = store.create(user_id=user_id, filename="one.pdf", mime_type="application/pdf", size_bytes=12)
    chapter = ChapterRecord("chapter", doc.id, user_id, "Title", 1, 1, 1)
    chunks = [
        ChunkRecord(f"chunk-{index}", doc.id, user_id, "chapter", f"source {index}", 1, index)
        for index in range(3)
    ]
    store.replace_structure(doc.id, [chapter], chunks)
    return doc


def _cards(count: int):
    return [
        {
            "id": f"card-{index}",
            "chapter_id": "chapter",
            "source_chunk_id": f"chunk-{index}",
            "source_quote": f"source {index}",
            "front": f"Q{index}",
            "back": f"A{index}",
        }
        for index in range(count)
    ]


def test_in_memory_account_document_cap_is_owner_scoped():
    store = InMemoryDocumentStore(max_documents_per_user=1)
    store.create(user_id="alice", filename="one.pdf", mime_type="application/pdf", size_bytes=12)
    with pytest.raises(InvalidInput, match="document limit"):
        store.create(user_id="alice", filename="two.pdf", mime_type="application/pdf", size_bytes=12)
    store.create(user_id="bob", filename="one.pdf", mime_type="application/pdf", size_bytes=12)


def test_structure_and_embedding_batches_are_bounded():
    store = InMemoryDocumentStore(max_chunks_per_document=1, max_embedding_batch=1)
    doc = store.create(user_id="alice", filename="one.pdf", mime_type="application/pdf", size_bytes=12)
    chapter = ChapterRecord("chapter", doc.id, "alice", "Title", 1, 1, 1)
    chunks = [ChunkRecord(str(index), doc.id, "alice", "chapter", "text", 1, index) for index in range(2)]
    with pytest.raises(InvalidInput, match="chunk limit"):
        store.replace_structure(doc.id, [chapter], chunks)
    store.replace_structure(doc.id, [chapter], chunks[:1])
    assert len(store.chunks_missing_embeddings(doc.id, limit=10000)) == 1
    with pytest.raises(InvalidInput, match="embedding batch"):
        store.chunks_missing_embeddings(doc.id, limit=0)


def test_embedding_handler_processes_missing_chunks_incrementally_in_bounded_batches():
    store = InMemoryDocumentStore(max_embedding_batch=2)
    doc = _document(store)

    class RecordingEmbedder:
        def __init__(self):
            self.batch_sizes = []

        def embed(self, texts):
            self.batch_sizes.append(len(texts))
            return [[float(index)] for index, _ in enumerate(texts)]

    embedder = RecordingEmbedder()
    handler = make_embed_handler(docs=store, embedder=embedder, batch_size=100)
    payload = {"document_id": doc.id, "user_id": "alice"}

    assert handler(payload)["embedded"] == 3
    assert embedder.batch_sizes == [2, 1]
    assert handler(payload)["embedded"] == 0


def test_flashcard_deck_cap_and_page_size_are_enforced():
    store = InMemoryDocumentStore(max_flashcards_per_deck=2, max_page_size=1)
    doc = _document(store)
    cards = _cards(2)
    assert store.add_flashcards(cards, document_id=doc.id, user_id="alice", due_date="2026-11-19") == 2
    assert store.add_flashcards(cards, document_id=doc.id, user_id="alice", due_date="2026-11-19") == 0
    assert [card["id"] for card in store.list_flashcards(doc.id, "alice", limit=50, offset=1)] == ["card-1"]
    assert [card["id"] for card in store.due_flashcards("alice", "2026-11-19", limit=50, offset=1)] == ["card-1"]
    with pytest.raises(InvalidInput, match="deck limit"):
        store.add_flashcards([_cards(3)[2]], document_id=doc.id, user_id="alice", due_date="2026-11-19")
    with pytest.raises(InvalidInput, match="page offset"):
        store.list_flashcards(doc.id, "alice", limit=1, offset=-1)


def test_constructor_rejects_invalid_caps():
    with pytest.raises(ValueError, match="limits"):
        InMemoryDocumentStore(max_page_size=0)
