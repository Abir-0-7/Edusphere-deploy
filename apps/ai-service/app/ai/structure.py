"""Chapter structuring via the LLM router (task 2.4).

Flow: bounded page digest -> LLM (JSON, schema-validated, re-asked once on bad
output) -> normalized against the real page count. If the output is still
invalid, fall back to a deterministic heading-based outline so the document is
usable. Provider outages (AllProvidersFailed) propagate so the job system retries.
"""

import logging

from app.ai.outline import Outline, OutlineInvalid, heuristic_outline, normalize_outline, page_digest
from app.ai.prompts import CHAPTER_SYSTEM, CHAPTER_USER_TEMPLATE
from app.ai.schemas import ChapterOutlineList, StructuredOutputError, complete_validated
from app.llm.router import LLMRouter
from app.parsing.pages import Page
from app.rag.injection import wrap_document_text

logger = logging.getLogger("studyvault.ai.structure")


def build_outline(
    router: LLMRouter,
    pages: list[Page],
    page_count: int,
    *,
    max_input_chars: int,
    max_chapters: int,
) -> tuple[list[Outline], str]:
    digest = page_digest(pages, max_input_chars)
    if not digest:
        return heuristic_outline(pages, page_count, max_chapters), "heuristic"
    user = CHAPTER_USER_TEMPLATE.format(page_count=page_count, wrapped_document=wrap_document_text(digest))
    try:
        parsed = complete_validated(router, ChapterOutlineList, CHAPTER_SYSTEM, user)
        return normalize_outline(parsed.chapters, page_count, max_chapters), "llm"
    except (StructuredOutputError, OutlineInvalid) as exc:
        logger.warning("chapter LLM output unusable, using heading fallback: %s", exc)
        return heuristic_outline(pages, page_count, max_chapters), "heuristic"
