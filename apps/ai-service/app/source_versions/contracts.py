"""Version-one evidence wire contract. PDF positions are always ONE-based.

Repository snapshots are an internal adapter boundary, not a public import API.
No submitted locator is fetched or executed by this module.
"""

import hashlib
import json
import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationInfo, field_validator, model_validator

MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
MAX_SEGMENTS = 2000
MAX_SEGMENT_CHARS = 16000
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Text = Annotated[str, Field(min_length=1, max_length=500)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    @field_validator("*", mode="after")
    @classmethod
    def database_safe_text(cls, value, info: ValidationInfo):
        if isinstance(value, str):
            if "\x00" in value:
                raise ValueError("source strings cannot contain NUL")
            if info.field_name in {
                "owner", "repository", "commit", "text_sha256", "original_sha256", "content_hash", "id",
            } and any(ord(char) < 32 or ord(char) == 127 for char in value):
                raise ValueError("source identifiers cannot contain control characters")
            try:
                value.encode("utf-8")
            except UnicodeEncodeError as exc:
                raise ValueError("source strings must be valid UTF-8") from exc
        return value


class PdfOrigin(Contract):
    kind: Literal["pdf"] = "pdf"
    document_id: UUID
    page_count: StrictInt = Field(ge=1, le=100000)
    book_title: Text | None = None
    edition: Text | None = None


class GithubOrigin(Contract):
    kind: Literal["github"] = "github"
    owner: str = Field(pattern=r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")
    repository: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.-]+$")
    commit: str = Field(pattern=r"^[0-9a-f]{40}$")

    @model_validator(mode="after")
    def safe_repository(self):
        if self.repository in {".", ".."}:
            raise ValueError("repository must name a GitHub repository")
        return self


class TextOrigin(Contract):
    kind: Literal["text"] = "text"
    format: Literal["notes", "txt", "html", "epub"]
    line_count: StrictInt = Field(ge=1, le=2000)


class PdfLocator(Contract):
    kind: Literal["pdf"] = "pdf"
    pdf_page_index: StrictInt = Field(ge=1, le=100000)
    printed_page_label: str | None = Field(default=None, min_length=1, max_length=80)
    chunk_id: UUID
    chapter_id: UUID | None = None


class NotebookCellLocator(Contract):
    index: StrictInt = Field(ge=0, le=255)
    cell_type: Literal["markdown", "code"]


class GithubLocator(Contract):
    kind: Literal["github"] = "github"
    path: str = Field(min_length=1, max_length=500)
    start_line: StrictInt = Field(ge=1, le=1000000)
    end_line: StrictInt = Field(ge=1, le=1000000)
    notebook_cell: NotebookCellLocator | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def safe_path_and_lines(self):
        if (
            self.end_line < self.start_line
            or self.end_line - self.start_line >= 1000
            or any(part in {"", ".", ".."} for part in self.path.split("/"))
            or re.search(r"[\\%:#?\x00-\x1f\x7f]", self.path)
        ):
            raise ValueError("repository locator must use a relative path and a bounded ordered line range")
        return self


class TextLocator(Contract):
    kind: Literal["text"] = "text"
    start_line: StrictInt = Field(ge=1, le=2000)
    end_line: StrictInt = Field(ge=1, le=2000)

    @model_validator(mode="after")
    def ordered(self):
        if self.end_line < self.start_line:
            raise ValueError("text lines must be ordered")
        return self


Locator = Annotated[PdfLocator | GithubLocator | TextLocator, Field(discriminator="kind")]
Origin = Annotated[PdfOrigin | GithubOrigin | TextOrigin, Field(discriminator="kind")]


class Rights(Contract):
    status: Literal["unknown", "user_declared", "public_license"] = "unknown"
    statement: str | None = Field(default=None, min_length=1, max_length=1000)

    @model_validator(mode="after")
    def declaration(self):
        if (self.status == "unknown") != (self.statement is None):
            raise ValueError("known rights need a statement; unknown rights must not imply a declaration")
        return self


class GithubFileProvenance(Contract):
    path: str = Field(min_length=1, max_length=500)
    git_blob_sha: str = Field(pattern=r"^[0-9a-f]{40}$")
    raw_sha256: Sha256
    byte_count: StrictInt = Field(ge=1, le=262144)

    @model_validator(mode="after")
    def file_path(self):
        GithubLocator(path=self.path, start_line=1, end_line=1)
        if not re.fullmatch(r"[0-9a-f]{40}", self.git_blob_sha):
            raise ValueError("blob SHA must be complete")
        if not re.fullmatch(r"[0-9a-f]{64}", self.raw_sha256):
            raise ValueError("raw hash must be complete")
        return self


class Provenance(Contract):
    adapter: Literal["legacy_pdf_chunks", "github_selected_text", "local_utf8_text"]
    parser_name: str | None = Field(default=None, min_length=1, max_length=120)
    parser_version: str | None = Field(default=None, min_length=1, max_length=120)
    original_sha256: Sha256 | None = None
    rights: Rights = Field(default_factory=Rights)
    repository_files: list[GithubFileProvenance] | None = Field(
        default=None, min_length=1, max_length=16, exclude_if=lambda value: value is None,
    )
    extraction_notes: list[Text] | None = Field(
        default=None, min_length=1, max_length=8, exclude_if=lambda value: value is None,
    )

    @model_validator(mode="after")
    def parser_pair(self):
        if (self.parser_name is None) != (self.parser_version is None):
            raise ValueError("parser name and version must be recorded together, or both unknown")
        if self.adapter == "legacy_pdf_chunks" and (
            self.parser_name is not None or self.original_sha256 is not None or self.repository_files is not None
        ):
            raise ValueError("legacy extraction cannot attest a parser or original-file hash")
        if self.adapter == "local_utf8_text" and (
            self.parser_name != "studyvault-local-text" or self.parser_version != "1"
            or self.original_sha256 is None or self.repository_files is not None
            or self.rights.status != "user_declared" or not self.rights.statement.strip()
        ):
            raise ValueError("local text requires extraction provenance and a rights declaration")
        if self.adapter != "local_utf8_text" and self.extraction_notes is not None:
            raise ValueError("extraction notes are reserved for local source adapters")
        return self


class SourceSegment(Contract):
    id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9_.:-]+$")
    locator: Locator
    text: str = Field(min_length=1, max_length=MAX_SEGMENT_CHARS)
    text_sha256: Sha256

    @model_validator(mode="after")
    def exact_content(self):
        if hashlib.sha256(self.text.encode("utf-8")).hexdigest() != self.text_sha256:
            raise ValueError("segment hash does not match its UTF-8 text")
        if isinstance(self.locator, (GithubLocator, TextLocator)) and len(self.text.splitlines()) != (
            self.locator.end_line - self.locator.start_line + 1
        ):
            raise ValueError("located text must contain exactly the selected lines")
        return self


class SourceSnapshot(Contract):
    schema_version: Literal[1] = 1
    title: Text
    origin: Origin
    provenance: Provenance
    segments: list[SourceSegment] = Field(min_length=1, max_length=MAX_SEGMENTS)

    @field_validator("schema_version", mode="before")
    @classmethod
    def version_not_boolean(cls, value):
        if isinstance(value, bool):
            raise ValueError("schema version must be a number")
        return value

    @model_validator(mode="after")
    def validate_snapshot(self):
        if len({item.id for item in self.segments}) != len(self.segments):
            raise ValueError("segment identifiers must be unique")
        adapter = {"pdf": "legacy_pdf_chunks", "github": "github_selected_text", "text": "local_utf8_text"}
        if self.provenance.adapter != adapter[self.origin.kind]:
            raise ValueError("adapter does not match source kind")
        next_text_line = 1
        for segment in self.segments:
            if segment.locator.kind != self.origin.kind:
                raise ValueError("segment kind does not match source kind")
            if isinstance(self.origin, PdfOrigin) and isinstance(segment.locator, PdfLocator):
                if segment.locator.pdf_page_index > self.origin.page_count:
                    raise ValueError("PDF position is outside the source")
                if segment.id != str(segment.locator.chunk_id):
                    raise ValueError("legacy PDF segment must retain its chunk identifier")
            if isinstance(segment.locator, TextLocator):
                start, end = segment.locator.start_line, segment.locator.end_line
                if start != next_text_line or segment.id != f"text:L{start}-L{end}":
                    raise ValueError("text segments must use consecutive line ranges and stable identifiers")
                next_text_line = end + 1
        if isinstance(self.origin, TextOrigin) and self.origin.line_count != next_text_line - 1:
            raise ValueError("text segments must cover the declared lines")
        if isinstance(self.origin, TextOrigin) and (
            (self.origin.format in {"html", "epub"}) != (self.provenance.extraction_notes is not None)
        ):
            raise ValueError("markup-derived line locators require extraction notes")
        if self.provenance.repository_files is not None:
            paths = [item.path for item in self.provenance.repository_files]
            if len(paths) != len(set(paths)) or any(segment.locator.path not in paths for segment in self.segments):
                raise ValueError("repository file provenance must uniquely cover each selected path")
        if len(self.canonical_bytes()) > MAX_SNAPSHOT_BYTES:
            raise ValueError("source snapshot exceeds the 2 MiB UTF-8 contract limit")
        return self

    def canonical_bytes(self) -> bytes:
        return json.dumps(
            self.model_dump(mode="json"), sort_keys=True, ensure_ascii=False, separators=(",", ":"),
        ).encode()

    def content_hash(self) -> str:
        return hashlib.sha256(self.canonical_bytes()).hexdigest()


class SourceVersion(Contract):
    id: UUID
    content_hash: Sha256
    snapshot: SourceSnapshot
    created_at: str

    @model_validator(mode="after")
    def verify_hash(self):
        if self.content_hash != self.snapshot.content_hash():
            raise ValueError("source version hash does not match snapshot")
        return self


class PdfSnapshotRequest(Contract):
    book_title: Text | None = None
    edition: Text | None = None
    # Keys are one-based PDF positions, never printed page labels.
    printed_page_labels: dict[str, Annotated[str, Field(min_length=1, max_length=80)]] = Field(
        default_factory=dict, max_length=2000
    )
    rights_statement: str | None = Field(default=None, min_length=1, max_length=1000)

    @model_validator(mode="after")
    def valid_page_keys(self):
        if any(not re.fullmatch(r"[1-9][0-9]{0,5}", key) for key in self.printed_page_labels):
            raise ValueError("printed labels must be keyed by one-based PDF page index")
        for label in self.printed_page_labels.values():
            if "\x00" in label:
                raise ValueError("printed labels cannot contain NUL")
            try:
                label.encode("utf-8")
            except UnicodeEncodeError as exc:
                raise ValueError("printed labels must be valid UTF-8") from exc
        return self


class EvidencePin(Contract):
    version_id: UUID
    content_hash: Sha256
    segment_id: str = Field(min_length=1, max_length=120)
    locator: Locator
    quote: str = Field(min_length=1, max_length=4000)


class ResolvedEvidence(Contract):
    pin: EvidencePin
    source_title: Text
    content: str = Field(min_length=1, max_length=MAX_SEGMENT_CHARS)
    canonical_url: str | None
    source_version_url: str
