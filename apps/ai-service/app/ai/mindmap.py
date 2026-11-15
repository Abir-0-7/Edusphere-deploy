"""Concept mind map (task 4.5): chapter chunks -> nodes/edges JSON for React Flow.

Schema-validated; on failure it degrades to a deterministic star map built from
the chapter titles and their key terms, so the UI always has something to draw.
"""

import logging
import re
from collections import Counter
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from app.ai.schemas import StructuredOutputError, complete_validated
from app.documents.store import ChapterRecord, ChunkRecord
from app.llm.router import LLMRouter

logger = logging.getLogger("studyvault.mindmap")

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "was", "were", "for", "on", "with",
    "as", "by", "that", "this", "it", "be", "from", "at", "which", "can", "also", "not", "but", "we",
}


class MapNode(BaseModel):
    id: str
    label: str = Field(min_length=1, max_length=120)
    kind: str = "concept"  # root|chapter|concept


class MapEdge(BaseModel):
    source: str
    target: str
    label: str = ""


class MindMap(BaseModel):
    nodes: list[MapNode] = Field(min_length=2)
    edges: list[MapEdge] = Field(min_length=1)


_SYSTEM = (
    "Build a concept mind map from the provided document. Return ONLY JSON: "
    "{\"nodes\": [{\"id\": \"n1\", \"label\": \"...\", \"kind\": "
    "\"root|chapter|concept\"}], \"edges\": [{\"source\": \"n1\", \"target\": "
    "\"n2\", \"label\": \"...\"}]}. One root node, one node per chapter, and "
    "2-4 concept nodes per chapter connected to it. Keep labels under 60 chars."
)


def build(router: LLMRouter, chapters: list[ChapterRecord], chunks: list[ChunkRecord]) -> MindMap:
    material = "\n".join(
        f"[{c.title}] " + " ".join(ch.content for ch in chunks if ch.chapter_id == c.id)[:1200]
        for c in chapters
    )[:8000]
    try:
        mm = complete_validated(router, MindMap, _SYSTEM, f"Document:\n{material}")
        if mm.nodes and mm.edges:
            return mm
    except (StructuredOutputError, ValidationError, ValueError):
        logger.warning("mind map generation failed; using the deterministic fallback", exc_info=True)
    return fallback(chapters, chunks)


def _keywords(text: str, n: int = 3) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z-]{3,}", text.lower())
    counts = Counter(w for w in words if w not in STOPWORDS)
    return [w for w, _ in counts.most_common(n)]


def fallback(chapters: list[ChapterRecord], chunks: list[ChunkRecord]) -> MindMap:
    """Star map: root -> chapters -> their top keywords. Always valid."""
    nodes = [MapNode(id="root", label="Document", kind="root")]
    edges: list[MapEdge] = []
    for i, chapter in enumerate(chapters, start=1):
        cid = f"ch{i}"
        nodes.append(MapNode(id=cid, label=chapter.title[:60], kind="chapter"))
        edges.append(MapEdge(source="root", target=cid))
        text = " ".join(ch.content for ch in chunks if ch.chapter_id == chapter.id)
        for j, word in enumerate(_keywords(text), start=1):
            nid = f"c{i}_{j}"
            nodes.append(MapNode(id=nid, label=word, kind="concept"))
            edges.append(MapEdge(source=cid, target=nid))
    if len(nodes) < 2:  # a document with no chapters still renders
        nodes.append(MapNode(id="empty", label="No chapters yet", kind="concept"))
        edges.append(MapEdge(source="root", target="empty"))
    return MindMap(nodes=nodes, edges=edges)


def as_json(mm: MindMap) -> dict[str, Any]:
    return mm.model_dump()