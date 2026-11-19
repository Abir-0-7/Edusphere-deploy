"""Flashcard generation from chapters (task 2.11).

Generates Q/A cards per chapter via the LLM router, validates against a schema,
and links each card back to the chapter's chunks so a card can cite its source.
"""

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from app.documents.store import ChapterRecord, ChunkRecord
from app.llm.router import LLMRouter

logger = logging.getLogger("studyvault.flashcards")


@dataclass
class Flashcard:
    id: str
    chapter_id: str
    source_chunk_id: str | None
    front: str
    back: str
    source_quote: str
    source_revision: str


_GEN_SYSTEM = (
    "Generate 3-5 concise flashcards (front/back) that test the key concepts in "
    "the provided chapter excerpt. Front = a question or term; back = a tight "
    "answer of one or two sentences. Return ONLY valid JSON: "
    '{"cards": [{"front": "...", "back": "..."}]}.'
)


def generate_for_chapter(
    *,
    chapter: ChapterRecord,
    chunks: list[ChunkRecord],
    router: LLMRouter,
    max_cards: int = 5,
) -> list[Flashcard]:
    """One chapter -> up to max_cards flashcards linked to the chapter's chunks."""
    text = "\n\n".join(c.content for c in chunks if c.chapter_id == chapter.id)
    if not text.strip():
        text = chapter.title
    raw = router.complete(
        [
            {"role": "system", "content": _GEN_SYSTEM},
            {"role": "user", "content": f"Chapter: {chapter.title}\n\n{text[:6000]}\nReturn JSON only."},
        ]
    )
    cards = _parse_cards(raw, chapter, chunks)
    return cards[:max_cards]


def _parse_cards(raw: str, chapter: ChapterRecord, chunks: list[ChunkRecord]) -> list[Flashcard]:
    text = raw.strip().strip("`")
    if text.lower().startswith("json"):
        text = text[4:].strip()
    start, end = text.find("{"), text.rfind("}")
    data: dict[str, Any] = {}
    if start != -1 and end > start:
        try:
            data = json.loads(text[start : end + 1])
        except ValueError:
            data = {}
    chapter_chunks = [c for c in chunks if c.chapter_id == chapter.id and c.content.strip()]
    out: list[Flashcard] = []
    for item in data.get("cards", []):
        front = str(item.get("front", "")).strip()
        back = str(item.get("back", "")).strip()
        if not front or not back:
            continue
        # Link to the first chunk of the chapter so the card can cite a source.
        source = chapter_chunks[0] if chapter_chunks else None
        if source is None:
            continue
        quote = source.content[: min(500, len(source.content))]
        revision_data = json.dumps(
            [chapter.document_id, chapter.id, source.id, source.content, quote],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        revision = hashlib.sha256(revision_data.encode("utf-8")).hexdigest()
        identity = json.dumps(
            [chapter.id, source.id, " ".join(front.split()), " ".join(back.split())], ensure_ascii=False
        )
        out.append(
            Flashcard(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"studyvault:flashcard:{identity}")),
                chapter_id=chapter.id,
                source_chunk_id=source.id,
                front=front,
                back=back,
                source_quote=quote,
                source_revision=revision,
            )
        )
    return out
