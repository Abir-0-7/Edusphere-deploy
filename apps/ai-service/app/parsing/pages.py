"""Split parsed Markdown back into pages using the `<!-- page N -->` markers
emitted by app.parsing.pdf.parse_pdf. Shared by chapter structuring (2.4) and
chunking (2.7) so page numbers stay consistent end to end.
"""

import re
from dataclasses import dataclass

PAGE_MARKER_RE = re.compile(r"^<!-- page (\d+) -->[ \t]*$", re.MULTILINE)


@dataclass(frozen=True)
class Page:
    number: int
    text: str


def split_pages(markdown: str) -> list[Page]:
    """Return pages in document order. Text before the first marker is page 1."""
    pages: list[Page] = []
    matches = list(PAGE_MARKER_RE.finditer(markdown))
    if not matches:
        text = markdown.strip()
        return [Page(1, text)] if text else []
    preamble = markdown[: matches[0].start()].strip()
    if preamble:
        pages.append(Page(1, preamble))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(markdown)
        text = markdown[m.end() : end].strip()
        if text:
            pages.append(Page(int(m.group(1)), text))
    return pages
