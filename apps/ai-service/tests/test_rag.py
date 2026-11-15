"""Tests for RAG chat parsing, embeddings fallback, and eval scoring."""

from app.ai.flashcards import _parse_cards
from app.documents.store import ChapterRecord, ChunkRecord
from app.rag.chat import _parse_answer
from app.rag.embeddings import HashEmbedder
from evals.rag_eval import CASES, recall_at_k


def _chunk(cid: str, content: str, page: int = 1) -> ChunkRecord:
    return ChunkRecord(
        id=cid, document_id="d", user_id="u", chapter_id="c1", content=content, page=page, ordinal=0
    )


def test_citations_to_unretrieved_chunks_are_dropped() -> None:
    hits = [(_chunk("11111111-1111-1111-1111-111111111111", "chlorophyll absorbs light"), 0.9)]
    raw = (
        '{"answer": "Chlorophyll absorbs light.", "citations": ['
        '{"chunk_id": "11111111-1111-1111-1111-111111111111", "page": 2, "quote": "chlorophyll"},'
        '{"chunk_id": "99999999-9999-9999-9999-999999999999", "page": 9, "quote": "made up"}]}'
    )
    answer, citations = _parse_answer(raw, hits)
    assert answer.startswith("Chlorophyll")
    assert len(citations) == 1
    assert citations[0].chunk_id == "11111111-1111-1111-1111-111111111111"
    assert citations[0].page == 2


def test_non_json_llm_output_is_insufficient_answer() -> None:
    answer, citations = _parse_answer("Sorry, I cannot help with that.", [(_chunk("abc", "x"), 0.1)])
    assert answer == "I don't know."
    assert citations == []


def test_hash_embedder_is_deterministic_and_normalised() -> None:
    e = HashEmbedder()
    a = e.embed(["hello world"])[0]
    b = e.embed(["hello world"])[0]
    assert a == b
    assert len(a) == 384
    assert abs(sum(v * v for v in a) ** 0.5 - 1.0) < 1e-6
    assert e.embed(["different"])[0] != a
    assert e.configured is False


def test_flashcard_parse_links_source_chunk() -> None:
    chapter = ChapterRecord(
        id="c1", document_id="d", user_id="u", title="Photosynthesis", ordinal=1, start_page=1, end_page=2
    )
    chunks = [_chunk("chunk-1", "light reactions"), _chunk("chunk-2", "calvin cycle")]
    raw = '{"cards": [{"front": "Q?", "back": "A."}, {"front": "", "back": "dropped"}]}'
    cards = _parse_cards(raw, chapter, chunks)
    assert len(cards) == 1
    assert cards[0].front == "Q?"
    assert cards[0].chapter_id == "c1"
    assert cards[0].source_chunk_id == "chunk-1"


def test_eval_recall_scoring() -> None:
    # One hit per case, all correct -> 1.0
    perfect = [[c.expected_phrase] for c in CASES]
    assert recall_at_k(perfect) == 1.0
    # None correct -> 0.0
    assert recall_at_k([["nothing relevant"] for _ in CASES]) == 0.0
    # Half correct
    half = [[c.expected_phrase] if i % 2 == 0 else ["nope"] for i, c in enumerate(CASES)]
    assert 0.4 <= recall_at_k(half) <= 0.6
