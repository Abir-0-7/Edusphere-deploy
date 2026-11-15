"""Task 2.4 pure logic: page splitting, LLM digest budget, outline normalization, heading fallback."""

from dataclasses import dataclass

import pytest

from app.ai.outline import Outline, OutlineInvalid, heuristic_outline, normalize_outline, page_digest
from app.parsing.pages import Page, split_pages


@dataclass
class Raw:
    title: str
    start_page: int
    end_page: int
    summary: str = ""


def test_split_pages_uses_markers_and_keeps_numbers() -> None:
    md = "<!-- page 1 -->\nIntro text\n\n<!-- page 3 -->\nThird page\n"
    assert split_pages(md) == [Page(1, "Intro text"), Page(3, "Third page")]


def test_split_pages_without_markers_is_single_page() -> None:
    assert split_pages("just text\n") == [Page(1, "just text")]
    assert split_pages("   \n") == []


def test_page_digest_respects_budget_and_keeps_headings() -> None:
    pages = [Page(i, f"## Heading {i}\n" + "body " * 500) for i in range(1, 201)]
    digest = page_digest(pages, max_chars=5000)
    assert len(digest) <= 5000
    assert digest.startswith("[page 1] ## Heading 1 :: body")


def test_normalize_clamps_sorts_and_dedupes() -> None:
    raw = [
        Raw("Later", 5, 99),  # end clamped to page_count
        Raw("Intro", 0, 4),  # start clamped to 1
        Raw("Intro", 1, 4),  # duplicate of the above after clamping
        Raw("   ", 2, 3),  # empty title dropped
        Raw("Backwards", 8, 6),  # start > end dropped
    ]
    out = normalize_outline(raw, page_count=10, max_chapters=60)
    assert out == [Outline("Intro", 1, 4), Outline("Later", 5, 10)]


def test_normalize_rejects_empty_or_too_many() -> None:
    with pytest.raises(OutlineInvalid):
        normalize_outline([Raw("x", 9, 2)], page_count=10, max_chapters=60)
    with pytest.raises(OutlineInvalid):
        normalize_outline([Raw(f"c{i}", i, i) for i in range(1, 6)], page_count=10, max_chapters=3)


def test_heuristic_outline_from_headings() -> None:
    pages = [Page(1, "preface"), Page(2, "## Cells\ntext"), Page(4, "## Energy\ntext"), Page(6, "more")]
    out = heuristic_outline(pages, page_count=6, max_chapters=60)
    # first chapter is stretched back to page 1 so no page is orphaned
    assert out == [Outline("Cells", 1, 3), Outline("Energy", 4, 6)]


def test_heuristic_outline_without_headings_is_whole_document() -> None:
    assert heuristic_outline([Page(1, "plain")], page_count=3, max_chapters=60) == [Outline("Full document", 1, 3)]


def test_heuristic_outline_groups_when_too_many_headings() -> None:
    pages = [Page(i, f"## H{i}") for i in range(1, 101)]
    out = heuristic_outline(pages, page_count=100, max_chapters=10)
    assert len(out) == 10
    assert out[0] == Outline("H1", 1, 10)
    assert out[-1].end_page == 100
