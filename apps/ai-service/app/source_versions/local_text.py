"""Bounded offline preparation of pasted notes and UTF-8 text files."""

import base64
import binascii
import hashlib
import re
from typing import Annotated, Literal

from pydantic import Field, TypeAdapter

from app.errors import InvalidInput, TooLarge
from app.source_versions.contracts import Contract, SourceSnapshot
from app.source_versions.local_markup import MARKUP_NOTES, epub_text, html_text

MAX_TEXT_BYTES = 128 * 1024
MAX_REQUEST_BYTES = 256 * 1024
MAX_TEXT_LINES = 2000
MAX_LINE_CHARS = 8000
MAX_SEGMENT_CHARS = 12000
BAD_CONTROLS = re.compile(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]")


class TextMetadata(Contract):
    title: str = Field(min_length=1, max_length=200)
    rights_statement: str = Field(min_length=1, max_length=1000)


class PastedNotesRequest(TextMetadata):
    format: Literal["notes"]
    text: str = Field(min_length=1, max_length=MAX_TEXT_BYTES)


class TextFileRequest(TextMetadata):
    format: Literal["txt", "html", "epub"]
    filename: str = Field(min_length=5, max_length=200)
    media_type: Literal["text/plain", "text/html", "application/epub+zip"]
    content_base64: str = Field(min_length=4, max_length=((MAX_TEXT_BYTES + 2) // 3) * 4)


TEXT_IMPORT = TypeAdapter(Annotated[PastedNotesRequest | TextFileRequest, Field(discriminator="format")])


def _raw_bytes(body: PastedNotesRequest | TextFileRequest) -> bytes:
    if isinstance(body, PastedNotesRequest):
        return body.text.encode("utf-8")
    suffixes = {"txt": (".txt",), "html": (".html", ".htm"), "epub": (".epub",)}
    media_types = {"txt": "text/plain", "html": "text/html", "epub": "application/epub+zip"}
    if (re.search(r"[\\/:\x00-\x1f\x7f]", body.filename)
            or not body.filename.lower().endswith(suffixes[body.format])
            or body.media_type != media_types[body.format]):
        raise InvalidInput("Choose a local file with a filename and media type matching its format")
    try:
        return base64.b64decode(body.content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidInput("Text file did not contain valid base64 bytes") from exc


def prepare_text_snapshot(body: PastedNotesRequest | TextFileRequest, checkpoint=lambda: None) -> SourceSnapshot:
    if not body.title.strip() or not body.rights_statement.strip():
        raise InvalidInput("A title and intended-use rights declaration are required")
    raw = _raw_bytes(body)
    if len(raw) > MAX_TEXT_BYTES:
        raise TooLarge("Local UTF-8 source exceeds the 128 KiB limit")
    checkpoint()
    if body.format == "html":
        content = html_text(raw, checkpoint)
    elif body.format == "epub":
        content = epub_text(raw, checkpoint)
    else:
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise InvalidInput("Choose text encoded in UTF-8") from exc
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    if len(content.encode("utf-8")) > MAX_TEXT_BYTES:
        raise TooLarge("Extracted local source exceeds the 128 KiB limit")
    if not content.strip() or BAD_CONTROLS.search(content):
        raise InvalidInput("Choose nonblank plain text without binary controls or ambiguous line separators")
    lines = content.splitlines(keepends=True)
    if len(lines) > MAX_TEXT_LINES or any(len(line.removesuffix("\n")) > MAX_LINE_CHARS for line in lines):
        raise TooLarge("Local UTF-8 source exceeds its line count or line length limit")
    segments = []
    start, size, parts = 1, 0, []

    def append_segment(end: int) -> None:
        value = "".join(parts)
        segments.append({
            "id": f"text:L{start}-L{end}", "locator": {"kind": "text", "start_line": start, "end_line": end},
            "text": value, "text_sha256": hashlib.sha256(value.encode("utf-8")).hexdigest(),
        })

    for index, line in enumerate(lines, start=1):
        if index % 64 == 0:
            checkpoint()
        if size + len(line) > MAX_SEGMENT_CHARS:
            append_segment(index - 1)
            start, size, parts = index, 0, []
        parts.append(line)
        size += len(line)
    append_segment(len(lines))
    return SourceSnapshot.model_validate({
        "title": body.title.strip(),
        "origin": {"kind": "text", "format": body.format, "line_count": len(lines)},
        "provenance": {
            "adapter": "local_utf8_text", "parser_name": "studyvault-local-text", "parser_version": "1",
            "original_sha256": hashlib.sha256(raw).hexdigest(),
            "rights": {"status": "user_declared", "statement": body.rights_statement.strip()},
            **({"extraction_notes": list(MARKUP_NOTES)} if body.format in {"html", "epub"} else {}),
        },
        "segments": segments,
    })
