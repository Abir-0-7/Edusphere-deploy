"""Evidence and version checks for source-linked flashcard drafts."""

from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.documents.store import ChapterRecord, ChunkRecord, DocumentRecord
from app.errors import InvalidInput
from app.flashcard_studio.contracts import DraftCard, GenerationSettings, MergeDraftRequest
from app.flashcard_studio.source import selected_chunks, source_revision, validate_evidence


def fixture():
    owner, document, chapter = (str(uuid4()) for _ in range(3))
    doc = DocumentRecord(id=document, user_id=owner, filename="lesson.pdf", mime_type="application/pdf", size_bytes=1)
    doc.chapters.append(ChapterRecord(chapter, document, owner, "Photosynthesis", 0, 1, 2))
    doc.chunks.append(
        ChunkRecord(str(uuid4()), document, owner, chapter, "Plants use chlorophyll to absorb light.", 1, 0)
    )
    settings = GenerationSettings(chapter_ids=[UUID(chapter)], language="en", difficulty="basic", count=5)
    return doc, settings


def test_revision_changes_with_source_and_settings_and_selection_checks_owner_scope():
    doc, settings = fixture()
    revision = source_revision(doc, settings)
    assert source_revision(doc, settings) == revision
    doc.chunks[0].content += " Water is also a reactant."
    assert source_revision(doc, settings) != revision
    doc.chunks[0].user_id = "other"
    with pytest.raises(InvalidInput):
        selected_chunks(doc, settings)


def test_draft_evidence_must_match_current_chunk_and_locator():
    doc, settings = fixture()
    chunk = doc.chunks[0]
    card = DraftCard(
        id=uuid4(), chapter_id=UUID(chunk.chapter_id), source_chunk_id=UUID(chunk.id),
        source_quote="chlorophyll to absorb light", front="What absorbs light?",
        back="Chlorophyll.", page=chunk.page,
    )
    validate_evidence(doc, [card])
    doc.chunks[0].content = "This is different text."
    with pytest.raises(InvalidInput):
        validate_evidence(doc, [card])


def test_generation_and_merge_contracts_reject_duplicate_ids_and_bounds():
    doc, settings = fixture()
    payload = settings.model_dump(mode="json")
    payload["chapter_ids"] *= 2
    with pytest.raises(ValidationError):
        GenerationSettings.model_validate(payload)
    identifier = uuid4()
    with pytest.raises(ValidationError):
        MergeDraftRequest(card_ids=[identifier, identifier])
