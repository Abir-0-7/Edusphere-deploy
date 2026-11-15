"""Chat with citations (task 2.10).

Strict grounding: the system prompt forbids answers outside retrieved context
and requires an "I don't know" fallback. Retrieved chunks are wrapped in
UNTRUSTED_DOCUMENT_TEXT delimiters (injection hardening). The model must emit
citations as {chunk_id, page, quote}; we only keep citations that point at a
real retrieved chunk.
"""

import json
import logging
from dataclasses import dataclass
from typing import Any

from app.documents.pg_store import PgDocumentStore
from app.documents.store import ChunkRecord, DocumentRecord
from app.llm.router import LLMRouter
from app.rag.embeddings import Embedder
from app.rag.injection import grounded_system_prompt

logger = logging.getLogger("studyvault.chat")

CITE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "citations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "chunk_id": {"type": "string"},
                    "page": {"type": ["integer", "null"]},
                    "quote": {"type": "string"},
                },
                "required": ["chunk_id", "quote"],
            },
        },
    },
    "required": ["answer", "citations"],
}

_BASE_SYSTEM = (
    "You are a study assistant. Answer the user's question ONLY from the "
    "provided document excerpts. If the excerpts are insufficient, reply "
    "exactly: I don't know. Every claim must cite the chunk it came from. "
    "Return ONLY valid JSON: {\"answer\": \"...\", \"citations\": "
    "[{\"chunk_id\": \"<id>\", \"page\": <n|null>, \"quote\": \"<verbatim>\"}]}."
)


@dataclass
class Citation:
    chunk_id: str
    page: int | None
    quote: str


@dataclass
class ChatAnswer:
    answer: str
    citations: list[Citation]
    session_id: str


def _format_context(chunks: list[tuple[ChunkRecord, float]]) -> str:
    blocks = []
    for ch, _ in chunks:
        blocks.append(f"[chunk {ch.id} | page {ch.page}]\n{ch.content}")
    return "\n\n".join(blocks)


def answer_question(
    *,
    doc: DocumentRecord,
    question: str,
    store: PgDocumentStore,
    embedder: Embedder,
    router: LLMRouter,
    session_messages: list[dict[str, Any]] | None = None,
    top_k: int = 8,
) -> ChatAnswer:
    q_emb = embedder.embed([question])[0] if embedder.configured else None
    hits = store.hybrid_search(
        document_id=doc.id, user_id=doc.user_id, query_text=question, embedding=q_emb, limit=top_k
    )
    if not hits:
        return ChatAnswer(answer="I don't know.", citations=[], session_id="")

    context = _format_context(hits)
    system, doc_block = grounded_system_prompt(_BASE_SYSTEM, context)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"{doc_block}\n\nQuestion: {question}\nReturn JSON only."},
    ]
    raw = router.complete(messages)
    answer, citations = _parse_answer(raw, hits)
    return ChatAnswer(answer=answer, citations=citations, session_id="")


def _parse_answer(raw: str, hits: list[tuple[ChunkRecord, float]]) -> tuple[str, list[Citation]]:
    """Extract the JSON answer; keep only citations that reference a retrieved chunk."""
    valid_ids = {ch.id: ch for ch, _ in hits}
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
    answer = str(data.get("answer", "")).strip() or "I don't know."
    citations: list[Citation] = []
    for c in data.get("citations", []):
        cid = c.get("chunk_id")
        if cid not in valid_ids:
            continue  # drop fabricated citations
        ch = valid_ids[cid]
        citations.append(Citation(chunk_id=cid, page=c.get("page") or ch.page, quote=str(c.get("quote", ""))))
    return answer, citations
