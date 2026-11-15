"""PDF validation and text extraction (tasks 2.1, 2.2).

- Type / size / page-count limits come from Settings.
- Encrypted and corrupt files produce clear, typed errors (never a crash).
- pdfplumber extracts text; pages with too little text are treated as scanned
  and routed to a pluggable OCR backend (Tesseract when available).
- Output is cleaned Markdown.
"""

import io
import logging
import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import Protocol

import pdfplumber
from pypdf import PdfReader

from app.errors import InvalidInput, TooLarge

logger = logging.getLogger("studyvault.parsing")

ALLOWED_MIME = {"application/pdf"}
ALLOWED_SUFFIX = {".pdf"}

PDF_MAGIC = b"%PDF-"

SCANNED_PAGE_MIN_CHARS = 20


class OcrBackend(Protocol):
    def ocr_page(self, page_image_bytes: bytes, page_number: int) -> str: ...


class TesseractOcrBackend:
    """Uses the tesseract binary when installed; reports clearly when not."""

    def __init__(self, lang: str = "eng") -> None:
        self.binary = shutil.which("tesseract")
        self.lang = lang

    @property
    def available(self) -> bool:
        return self.binary is not None

    def ocr_page(self, page_image_bytes: bytes, page_number: int) -> str:
        if self.binary is None:
            raise RuntimeError(
                "Tesseract is not installed; scanned page OCR unavailable (see TASKS 2.2)"
            )
        proc = subprocess.run(  # noqa: S603 - fixed argv, no shell
            [self.binary, "stdin", "stdout", "-l", self.lang],
            input=page_image_bytes,
            capture_output=True,
            check=False,
            timeout=60,
        )
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace").strip()[:300]
            raise RuntimeError(f"tesseract exited {proc.returncode}: {err}")
        return proc.stdout.decode("utf-8", errors="replace")


@dataclass
class ParseResult:
    markdown: str
    page_count: int
    ocr_pages: list[int]


def validate_pdf(data: bytes, filename: str, content_type: str | None, *, max_mb: int, max_pages: int) -> None:
    mime = (content_type or "").split(";")[0].strip().lower()
    suffix_ok = bool(filename) and filename.lower().endswith(tuple(ALLOWED_SUFFIX))
    if not suffix_ok or (mime not in ALLOWED_MIME and mime != "application/octet-stream"):
        raise InvalidInput("Only PDF files are accepted", details={"content_type": content_type})
    if len(data) > max_mb * 1024 * 1024:
        raise TooLarge(f"File exceeds the {max_mb} MB limit", details={"size_bytes": len(data)})
    # Content check: a renamed non-PDF must not pass on filename/mime alone.
    if PDF_MAGIC not in data[:1024]:
        raise InvalidInput("File is not a PDF", details={"reason": "missing %PDF- header"})
    reader = _reader(data)
    if reader.is_encrypted and not _try_empty_password(reader):
        raise InvalidInput("This PDF is password-protected and cannot be processed")
    page_count = _page_count(reader)
    if page_count > max_pages:
        raise TooLarge(f"PDF has {page_count} pages; limit is {max_pages}")


def parse_pdf(
    data: bytes,
    *,
    max_pages: int,
    ocr: OcrBackend | None = None,
) -> ParseResult:
    """Extract text -> cleaned Markdown. Scanned pages go through OCR if available."""
    reader = _reader(data)
    if reader.is_encrypted:
        if not _try_empty_password(reader):
            raise InvalidInput("This PDF is password-protected and cannot be processed")
    page_count = _page_count(reader)
    if page_count > max_pages:
        raise TooLarge(f"PDF has {page_count} pages; limit is {max_pages}")

    parts: list[str] = []
    ocr_pages: list[int] = []  # pages with no usable text after extraction + OCR
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if len(text.strip()) < SCANNED_PAGE_MIN_CHARS:
                ocr_text = ""
                if ocr is not None:
                    try:
                        ocr_text = ocr.ocr_page(_page_image_bytes(page), i)
                    except Exception as exc:  # noqa: BLE001 - OCR is best-effort per page; logged + recorded
                        logger.warning("OCR failed on page %d: %s", i, exc)
                if ocr_text.strip():
                    text = ocr_text
                elif not text.strip():
                    ocr_pages.append(i)
            parts.append(f"<!-- page {i} -->\n{text.strip()}" if text.strip() else "")
    markdown = clean_markdown("\n\n".join(p for p in parts if p))
    if ocr_pages:
        logger.info("pages without extractable text (OCR skipped/failed): %s", ocr_pages)
    return ParseResult(markdown=markdown, page_count=page_count, ocr_pages=ocr_pages)


def clean_markdown(text: str) -> str:
    # Normalize lines; heuristic headings for short ALL-CAPS lines.
    lines = []
    for line in text.splitlines():
        line = line.rstrip()
        stripped = line.strip()
        if stripped and len(stripped) <= 60 and stripped == stripped.upper() and any(c.isalpha() for c in stripped):
            lines.append(f"## {stripped.title()}")
        else:
            lines.append(line)
    out = "\n".join(lines)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip() + "\n"


def _reader(data: bytes) -> PdfReader:
    try:
        return PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise InvalidInput("File is not a readable PDF", details={"reason": str(exc)}) from exc


def _page_count(reader: PdfReader) -> int:
    try:
        return len(reader.pages)
    except Exception as exc:
        raise InvalidInput("File is not a readable PDF", details={"reason": str(exc)}) from exc


def _try_empty_password(reader: PdfReader) -> bool:
    try:
        return bool(reader.decrypt(""))
    except Exception as exc:  # noqa: BLE001 - any decrypt failure means "can't open"; logged
        logger.info("empty-password decrypt failed: %s", exc)
        return False


def _page_image_bytes(page: object) -> bytes:
    # pdfplumber page.to_image(resolution=150).original is a PIL image in-memory.
    image = page.to_image(resolution=150).original  # type: ignore[attr-defined]
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()
