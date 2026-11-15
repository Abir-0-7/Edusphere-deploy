"""Chunking with overlap and chapter/page metadata (task 2.7)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ChunkInput:
    text: str
    page: int | None = None
    chapter_title: str | None = None
    chapter_ordinal: int | None = None


@dataclass(frozen=True)
class Chunk:
    content: str
    ordinal: int
    page: int | None = None
    chapter_title: str | None = None
    chapter_ordinal: int | None = None


def chunk_markdown(
    chunks_in: list[ChunkInput],
    max_chars: int = 1200,
    overlap_chars: int = 150,
) -> list[Chunk]:
    """Split text into chunks of at most max_chars, with char-level overlap.

    Splits prefer paragraph boundaries (\\n\\n), then sentences, then hard cut.
    Metadata comes from the source block; overlapping chunks inherit it.
    """
    if max_chars <= overlap_chars:
        raise ValueError("max_chars must be greater than overlap_chars")
    out: list[Chunk] = []
    ordinal = 0
    for block in chunks_in:
        text = block.text.strip()
        if not text:
            continue
        pos = 0
        while pos < len(text):
            window = text[pos : pos + max_chars]
            if pos + max_chars < len(text):
                cut = _cut_point(window)
                piece = window[:cut]
            else:
                piece = window
            piece = piece.strip()
            if piece:
                out.append(
                    Chunk(
                        content=piece,
                        ordinal=ordinal,
                        page=block.page,
                        chapter_title=block.chapter_title,
                        chapter_ordinal=block.chapter_ordinal,
                    )
                )
                ordinal += 1
            if pos + max_chars >= len(text):
                break
            # Advance so the next chunk re-includes the last overlap_chars of this
            # piece, but always make forward progress.
            pos += max(len(piece) - overlap_chars, 1)
    return out


@dataclass(frozen=True)
class ChapterSpan:
    title: str
    ordinal: int
    start_page: int
    end_page: int


def chunk_inputs_from_pages(pages: list[tuple[int, str]], chapters: list[ChapterSpan]) -> list[ChunkInput]:
    """One ChunkInput per page, tagged with the chapter whose range covers it.

    Chunks never span pages, so every chunk cites exactly one page. When chapter
    ranges overlap, the chapter that starts latest (most specific) wins.
    """
    ordered = sorted(chapters, key=lambda c: (c.start_page, c.ordinal))
    out: list[ChunkInput] = []
    for number, text in pages:
        owner = None
        for ch in ordered:
            if ch.start_page <= number <= ch.end_page:
                owner = ch
        out.append(
            ChunkInput(
                text=text,
                page=number,
                chapter_title=owner.title if owner else None,
                chapter_ordinal=owner.ordinal if owner else None,
            )
        )
    return out


def _cut_point(window: str) -> int:
    for sep in ("\n\n", "\n", ". ", "."):
        idx = window.rfind(sep)
        if idx > 0:
            return idx + len(sep)
    return len(window)
