"""Generation tests exercise evidence selection without calling real providers."""

import json
from uuid import UUID, uuid4

import pytest

from app.documents.store import ChapterRecord, ChunkRecord, InMemoryDocumentStore
from app.flashcard_studio.contracts import GenerationSettings
from app.flashcard_studio.service import make_studio_handler, prompt_input
from app.flashcard_studio.source import source_revision
from app.flashcard_studio.store import MemoryFlashcardStudioStore


class FakeRouter:
    def __init__(self, response: str) -> None:
        self.response = response
        self.accepted = False

    def complete(self, _messages):
        return self.response

    def accept_cache_candidate(self) -> None:
        self.accepted = True


def fixture():
    docs = InMemoryDocumentStore()
    document = docs.create(user_id="studio-owner", filename="lesson.pdf", mime_type="application/pdf", size_bytes=10)
    chapter = ChapterRecord(str(uuid4()), document.id, document.user_id, "Photosynthesis", 0, 1, 1)
    chunk = ChunkRecord(
        str(uuid4()), document.id, document.user_id, chapter.id,
        "Chlorophyll absorbs light. The chloroplast converts energy.", 1, 0,
    )
    docs.replace_structure(document.id, [chapter], [chunk])
    settings = GenerationSettings(chapter_ids=[UUID(chapter.id)], language="en", difficulty="basic", count=5)
    return docs, document, chapter, chunk, settings


def response(chunk: ChunkRecord, *, quote: str | None = None, front: str = "What absorbs light?") -> str:
    return json.dumps({"cards": [{
        "source_chunk_id": chunk.id,
        "source_quote": quote or chunk.content[:30],
        "front": front,
        "back": "Chlorophyll.",
    }]})


def payload(document_id: str, user_id: str, settings: GenerationSettings, revision: str, job_id: str) -> dict:
    return {
        "document_id": document_id, "user_id": user_id, "job_id": job_id,
        "source_revision": revision, "settings": settings.model_dump(mode="json"),
    }


def test_prompt_includes_bounded_chapter_evidence_and_is_not_empty():
    docs, document, chapter, chunk, settings = fixture()
    prompt, excerpts = prompt_input(docs.get_for_user(document.id, document.user_id), settings, 4096)
    data = json.loads(prompt)
    assert data["excerpts"] == [{
        "source_chunk_id": chunk.id, "chapter": chapter.title, "text": chunk.content,
    }]
    assert excerpts[chunk.id] == chunk.content


def test_handler_saves_valid_source_bound_preview_without_publishing_cards():
    docs, document, _, chunk, settings = fixture()
    store, router, draft_id = MemoryFlashcardStudioStore(docs), FakeRouter(response(chunk)), str(uuid4())
    handler = make_studio_handler(
        get_document=docs.get_for_user, store=store, router=router, max_input_chars=4096,
    )
    revision = source_revision(document, settings)
    result = handler(payload(document.id, document.user_id, settings, revision, draft_id))
    draft = store.get_draft(document.id, document.user_id, draft_id)
    assert result == {"draft_id": draft_id}
    assert draft.cards[0].source_chunk_id == UUID(chunk.id)
    assert router.accepted
    assert docs.list_flashcards(document.id, document.user_id) == []


@pytest.mark.parametrize("body", [
    "not JSON",
    '{"cards":[{"source_chunk_id":"not-a-uuid","source_quote":"invented","front":"Q?","back":"A."}]}',
])
def test_handler_rejects_unverified_drafts_without_accepting_router_cache(body):
    docs, document, _, _, settings = fixture()
    router = FakeRouter(body)
    handler = make_studio_handler(
        get_document=docs.get_for_user, store=MemoryFlashcardStudioStore(docs),
        router=router, max_input_chars=4096,
    )
    draft_id = str(uuid4())
    with pytest.raises(Exception, match="invalid cards or source evidence"):
        handler(payload(document.id, document.user_id, settings, source_revision(document, settings), draft_id))
    assert not router.accepted


def test_handler_refuses_stale_source_after_queued_settings():
    docs, document, _, chunk, settings = fixture()
    router = FakeRouter(response(chunk))
    handler = make_studio_handler(
        get_document=docs.get_for_user, store=MemoryFlashcardStudioStore(docs),
        router=router, max_input_chars=4096,
    )
    revision = source_revision(document, settings)
    document.chunks[0].content += " Revised."
    with pytest.raises(Exception, match="source changed"):
        handler(payload(document.id, document.user_id, settings, revision, str(uuid4())))
    assert not router.accepted


@pytest.mark.parametrize(
    "front",
    [
        "What absorbs light? Why is that important?",
        "What absorbs light and why does it matter?",
        "What is it?",
    ],
)
def test_handler_rejects_multiple_or_vague_questions(front):
    docs, document, _, chunk, settings = fixture()
    router = FakeRouter(response(chunk, front=front))
    handler = make_studio_handler(
        get_document=docs.get_for_user, store=MemoryFlashcardStudioStore(docs),
        router=router, max_input_chars=4096,
    )
    with pytest.raises(Exception, match="invalid cards or source evidence"):
        handler(payload(document.id, document.user_id, settings, source_revision(document, settings), str(uuid4())))
    assert not router.accepted


def test_handler_rejects_repeated_question_even_when_each_quote_is_supported():
    docs, document, _, chunk, settings = fixture()
    duplicated = json.loads(response(chunk))
    duplicated["cards"].append(dict(duplicated["cards"][0]))
    router = FakeRouter(json.dumps(duplicated))
    handler = make_studio_handler(
        get_document=docs.get_for_user, store=MemoryFlashcardStudioStore(docs),
        router=router, max_input_chars=4096,
    )
    with pytest.raises(Exception, match="invalid cards or source evidence"):
        handler(payload(document.id, document.user_id, settings, source_revision(document, settings), str(uuid4())))
    assert not router.accepted
