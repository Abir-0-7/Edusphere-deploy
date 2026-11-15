import io

import pytest
from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.errors import InvalidInput, TooLarge
from app.parsing.pdf import ParseResult, parse_pdf, validate_pdf


def make_text_pdf(pages: int = 3) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    for i in range(1, pages + 1):
        c.setFont("Helvetica-Bold", 16)
        c.drawString(72, 720, f"CHAPTER {i}")
        c.setFont("Helvetica", 11)
        for line in range(10):
            c.drawString(72, 690 - line * 14, f"Page {i} line {line}: photosynthesis converts light into energy.")
        c.showPage()
    c.save()
    return buf.getvalue()


def make_image_only_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    img = Image.new("RGB", (200, 100), "white")
    c.drawImage(ImageReader(img), 72, 400, 200, 100)
    c.showPage()
    c.save()
    return buf.getvalue()


def make_encrypted_pdf() -> bytes:
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(make_text_pdf(1)))
    writer = PdfWriter()
    writer.append(reader)
    writer.encrypt("secret")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def test_validate_accepts_valid_pdf() -> None:
    data = make_text_pdf(2)
    validate_pdf(data, "lecture.pdf", "application/pdf", max_mb=20, max_pages=300)


def test_validate_rejects_wrong_type() -> None:
    with pytest.raises(InvalidInput):
        validate_pdf(b"not a pdf", "notes.txt", "text/plain", max_mb=20, max_pages=300)


def test_validate_rejects_oversize() -> None:
    with pytest.raises(TooLarge):
        validate_pdf(b"x" * (2 * 1024 * 1024), "lecture.pdf", "application/pdf", max_mb=1, max_pages=300)


def test_validate_rejects_too_many_pages() -> None:
    data = make_text_pdf(3)
    with pytest.raises(TooLarge):
        validate_pdf(data, "lecture.pdf", "application/pdf", max_mb=20, max_pages=2)


def test_encrypted_pdf_raises_clear_error() -> None:
    data = make_encrypted_pdf()
    with pytest.raises(InvalidInput, match="password"):
        parse_pdf(data, max_pages=300)


def test_corrupt_file_raises_clear_error() -> None:
    with pytest.raises(InvalidInput, match="readable PDF"):
        parse_pdf(b"%PDF-1.4 this is broken", max_pages=300)


def test_text_pdf_produces_markdown_with_pages() -> None:
    result = parse_pdf(make_text_pdf(3), max_pages=300)
    assert isinstance(result, ParseResult)
    assert result.page_count == 3
    assert result.ocr_pages == []
    assert "photosynthesis" in result.markdown
    assert "<!-- page 2 -->" in result.markdown
    assert "## Chapter 1" in result.markdown  # heading heuristic


def test_scanned_page_uses_ocr_backend() -> None:
    class FakeOcr:
        def __init__(self) -> None:
            self.called: list[int] = []

        def ocr_page(self, image_bytes: bytes, page_number: int) -> str:
            self.called.append(page_number)
            return "SCANNED TEXT FROM OCR"

    data = make_image_only_pdf()
    ocr = FakeOcr()
    result = parse_pdf(data, max_pages=300, ocr=ocr)
    assert ocr.called == [1]
    assert "scanned text from ocr" in result.markdown.lower()


# --- Task 2.1: upload hardening -------------------------------------------


def test_validate_rejects_encrypted_pdf_at_upload() -> None:
    with pytest.raises(InvalidInput, match="password"):
        validate_pdf(make_encrypted_pdf(), "locked.pdf", "application/pdf", max_mb=20, max_pages=300)


def test_validate_rejects_renamed_non_pdf() -> None:
    with pytest.raises(InvalidInput, match="not a PDF"):
        validate_pdf(b"PK\x03\x04 zip pretending", "lecture.pdf", "application/pdf", max_mb=20, max_pages=300)


def test_read_bounded_stops_at_limit() -> None:
    import asyncio

    from app.parsing.upload import READ_CHUNK_BYTES, read_bounded

    class FakeUpload:
        def __init__(self, total: int) -> None:
            self.remaining = total
            self.reads = 0

        async def read(self, size: int = -1) -> bytes:
            self.reads += 1
            n = min(size, self.remaining)
            self.remaining -= n
            return b"x" * n

    small = FakeUpload(1000)
    assert len(asyncio.run(read_bounded(small, max_mb=1))) == 1000

    huge = FakeUpload(50 * 1024 * 1024)
    with pytest.raises(TooLarge):
        asyncio.run(read_bounded(huge, max_mb=1))
    # stopped right after crossing the limit; never buffered the whole 50 MB
    assert huge.reads <= (1024 * 1024) // READ_CHUNK_BYTES + 1


# --- Task 2.2: OCR behaviour ------------------------------------------------


def test_failed_ocr_page_is_recorded_not_crashed() -> None:
    class BrokenOcr:
        def ocr_page(self, image_bytes: bytes, page_number: int) -> str:
            raise RuntimeError("ocr exploded")

    result = parse_pdf(make_image_only_pdf(), max_pages=300, ocr=BrokenOcr())
    assert result.ocr_pages == [1]


def make_scanned_text_pdf(lines: list[str]) -> bytes:
    """A page that is only an image of rendered text (no text layer)."""
    from PIL import ImageDraw, ImageFont

    img = Image.new("L", (1700, 120 * len(lines) + 80), 255)
    draw = ImageDraw.Draw(img)
    try:
        font: ImageFont.ImageFont | ImageFont.FreeTypeFont = ImageFont.truetype("DejaVuSans.ttf", 48)
    except OSError:
        font = ImageFont.load_default(size=48)
    for n, line in enumerate(lines):
        draw.text((40, 40 + n * 110), line, fill=0, font=font)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    c.drawImage(ImageReader(img), 36, 300, 540, 540 * img.height / img.width)
    c.showPage()
    c.save()
    return buf.getvalue()


@pytest.mark.skipif(__import__("shutil").which("tesseract") is None, reason="tesseract binary not installed")
def test_scanned_pdf_real_tesseract_produces_markdown() -> None:
    from app.parsing.pdf import TesseractOcrBackend

    data = make_scanned_text_pdf(["Mitochondria produce ATP", "through oxidative phosphorylation."])
    result = parse_pdf(data, max_pages=300, ocr=TesseractOcrBackend())
    assert result.ocr_pages == []
    assert "<!-- page 1 -->" in result.markdown
    assert "mitochondria" in result.markdown.lower()
