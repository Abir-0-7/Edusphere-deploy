"""Deterministic source selection and verification for Flashcard Studio."""

import hashlib
import json
from dataclasses import asdict
from itertools import zip_longest

from app.documents.store import ChunkRecord, DocumentRecord
from app.errors import InvalidInput
from app.flashcard_studio.contracts import DraftCard, GenerationSettings


def selected_chunks(doc: DocumentRecord, settings: GenerationSettings) -> list[ChunkRecord]:
    selected = {str(value) for value in settings.chapter_ids}
    chapters = sorted(
        (
            row for row in doc.chapters
            if row.document_id == doc.id and row.user_id == doc.user_id and row.id in selected
        ),
        key=lambda row: (row.ordinal, row.id),
    )
    if {row.id for row in chapters} != selected:
        raise InvalidInput("Select chapters that belong to this source")
    grouped: dict[str, list[ChunkRecord]] = {row.id: [] for row in chapters}
    for chunk in sorted(doc.chunks, key=lambda row: (row.ordinal, row.id)):
        if (
            chunk.chapter_id is not None
            and chunk.chapter_id in grouped
            and chunk.document_id == doc.id
            and chunk.user_id == doc.user_id
            and chunk.content.strip()
        ):
            grouped[chunk.chapter_id].append(chunk)
    if not all(grouped.values()):
        raise InvalidInput("Each selected chapter needs source text before cards can be generated")
    # Round robin puts an excerpt from every chapter ahead of later excerpts.
    return [chunk for group in zip_longest(*grouped.values()) for chunk in group if chunk is not None]


def source_revision(doc: DocumentRecord, settings: GenerationSettings) -> str:
    chunks = selected_chunks(doc, settings)
    chapter_ids = {chunk.chapter_id for chunk in chunks}
    data = {
        "document": doc.id,
        "owner": doc.user_id,
        "chapters": [asdict(row) for row in sorted(doc.chapters, key=lambda row: row.id) if row.id in chapter_ids],
        "chunks": [asdict(row) for row in chunks],
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def validate_evidence(doc: DocumentRecord, cards: list[DraftCard]) -> None:
    chapters = {row.id for row in doc.chapters if row.document_id == doc.id and row.user_id == doc.user_id}
    chunks = {row.id: row for row in doc.chunks if row.document_id == doc.id and row.user_id == doc.user_id}
    for card in cards:
        chapter = str(card.chapter_id)
        chunk = chunks.get(str(card.source_chunk_id))
        if (
            chapter not in chapters
            or chunk is None
            or chunk.chapter_id != chapter
            or card.page != chunk.page
            or card.source_quote not in chunk.content
        ):
            raise InvalidInput("Card evidence no longer matches the selected source")
