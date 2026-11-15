"""Pure helpers for chapter structuring (task 2.4). No LLM, no pydantic.

- page_digest: bounded per-page preview sent to the LLM, so a 300-page PDF
  never blows the model context. Budget comes from settings.
- normalize_outline: clamps/sorts/dedupes LLM chapters against the real page
  count. Raises OutlineInvalid if nothing usable remains.
- heuristic_outline: deterministic fallback from `## ` headings when the LLM
  output stays invalid after retries.
"""

import math
from dataclasses import dataclass
from typing import Protocol

from app.parsing.pages import Page


class OutlineInvalid(ValueError):
    pass


@dataclass(frozen=True)
class Outline:
    title: str
    start_page: int
    end_page: int
    summary: str = ""


class OutlineLike(Protocol):
    @property
    def title(self) -> str: ...
    @property
    def start_page(self) -> int: ...
    @property
    def end_page(self) -> int: ...
    @property
    def summary(self) -> str: ...


MIN_CHARS_PER_PAGE = 80


def page_digest(pages: list[Page], max_chars: int) -> str:
    """Headings plus the opening of each page, within a total character budget."""
    if not pages:
        return ""
    per_page = max(max_chars // len(pages), MIN_CHARS_PER_PAGE)
    out: list[str] = []
    used = 0
    for page in pages:
        lines = [ln.strip() for ln in page.text.splitlines() if ln.strip()]
        headings = [ln for ln in lines if ln.startswith("#")]
        body = " ".join(ln for ln in lines if not ln.startswith("#"))
        preview = (" | ".join(headings) + (" :: " if headings else "") + body)[:per_page]
        entry = f"[page {page.number}] {preview}"
        if used + len(entry) > max_chars:
            break
        out.append(entry)
        used += len(entry) + 1
    return "\n".join(out)


def normalize_outline(items: list[OutlineLike], page_count: int, max_chapters: int) -> list[Outline]:
    if page_count < 1:
        raise OutlineInvalid("document has no pages")
    cleaned: list[Outline] = []
    seen: set[tuple[int, str]] = set()
    for it in items:
        title = " ".join(str(it.title).split())[:200]
        if not title:
            continue
        start = min(max(int(it.start_page), 1), page_count)
        end = min(max(int(it.end_page), 1), page_count)
        if start > end:
            continue
        key = (start, title.lower())
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(Outline(title, start, end, " ".join(str(it.summary).split())[:500]))
    cleaned.sort(key=lambda o: (o.start_page, o.end_page))
    if not cleaned:
        raise OutlineInvalid("no usable chapters in LLM output")
    if len(cleaned) > max_chapters:
        raise OutlineInvalid(f"{len(cleaned)} chapters exceeds limit {max_chapters}")
    return cleaned


def heuristic_outline(pages: list[Page], page_count: int, max_chapters: int) -> list[Outline]:
    """One chapter per page that opens with a `## ` heading; grouped if too many."""
    page_count = max(page_count, 1)
    starts: list[tuple[int, str]] = []
    for page in pages:
        heading = next((ln[2:].strip() for ln in page.text.splitlines() if ln.startswith("## ")), None)
        if heading and (not starts or starts[-1][0] != page.number):
            starts.append((page.number, heading))
    if not starts:
        return [Outline("Full document", 1, page_count)]
    if len(starts) > max_chapters:
        size = math.ceil(page_count / max_chapters)
        grouped: list[Outline] = []
        for first in range(1, page_count + 1, size):
            last = min(first + size - 1, page_count)
            title = next((t for p, t in starts if first <= p <= last), f"Pages {first}-{last}")
            grouped.append(Outline(title, first, last))
        return grouped
    if starts[0][0] != 1:
        starts[0] = (1, starts[0][1])
    return [
        Outline(title, start, (starts[i + 1][0] - 1) if i + 1 < len(starts) else page_count)
        for i, (start, title) in enumerate(starts)
    ]
