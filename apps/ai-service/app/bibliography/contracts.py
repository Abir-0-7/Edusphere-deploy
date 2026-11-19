from datetime import date, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

BibliographyKind = Literal["book", "book_chapter", "journal_article", "website", "repository"]
BibliographyField = Literal[
    "title",
    "authors",
    "issued",
    "container_title",
    "edition",
    "volume",
    "issue",
    "item_pages",
    "publisher",
    "doi",
    "url",
    "accessed",
    "repository_commit",
    "isbn",
]
MetadataSource = Literal["manual", "bibtex", "ris", "csl_json", "doi", "url", "isbn"]
SuggestionSource = Literal["bibtex", "ris", "csl_json", "doi", "url", "isbn"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BibliographyDate(Contract):
    year: Annotated[int, Field(ge=1, le=9999)] | None = None
    month: Annotated[int, Field(ge=1, le=12)] | None = None
    day: Annotated[int, Field(ge=1, le=31)] | None = None
    literal: Annotated[str, Field(min_length=1, max_length=120)] | None = None

    @model_validator(mode="after")
    def validate_parts(self):
        if self.month is not None and self.year is None:
            raise ValueError("month requires year")
        if self.day is not None and self.month is None:
            raise ValueError("day requires month")
        if self.literal and any((self.year, self.month, self.day)):
            raise ValueError("literal date cannot be combined with date parts")
        if self.day is not None:
            date(self.year or 2000, self.month or 1, self.day)
        return self


class BibliographyAuthor(Contract):
    family: Annotated[str, Field(max_length=160)] | None = None
    given: Annotated[str, Field(max_length=160)] | None = None
    literal: Annotated[str, Field(max_length=240)] | None = None
    suffix: Annotated[str, Field(max_length=40)] | None = None

    @model_validator(mode="after")
    def validate_name(self):
        if not any(value and value.strip() for value in (self.family, self.given, self.literal)):
            raise ValueError("author must have a literal or structured name")
        if self.literal and any(value and value.strip() for value in (self.family, self.given, self.suffix)):
            raise ValueError("literal author cannot be combined with structured name parts")
        return self


class BibliographyProvenance(Contract):
    field: BibliographyField
    source: MetadataSource
    confirmed: bool

    @model_validator(mode="after")
    def validate_manual_confirmation(self):
        if self.source == "manual" and not self.confirmed:
            raise ValueError("manually entered metadata must be confirmed")
        return self


class BibliographyMetadataSuggestion(Contract):
    field: BibliographyField
    value: Annotated[str, Field(min_length=1, max_length=4000)]
    source: SuggestionSource


class BibliographyItemInput(Contract):
    kind: BibliographyKind
    title: Annotated[str, Field(max_length=2000)] = ""
    authors: list[BibliographyAuthor] = Field(default_factory=list, max_length=40)
    issued: BibliographyDate | None = None
    container_title: Annotated[str, Field(max_length=1000)] = ""
    edition: Annotated[str, Field(max_length=120)] = ""
    volume: Annotated[str, Field(max_length=80)] = ""
    issue: Annotated[str, Field(max_length=80)] = ""
    item_pages: Annotated[str, Field(max_length=120)] = ""
    publisher: Annotated[str, Field(max_length=300)] = ""
    doi: Annotated[str, Field(max_length=300)] = ""
    isbn: Annotated[str, Field(max_length=17)] = ""
    url: Annotated[str, Field(max_length=2048)] = ""
    accessed: BibliographyDate | None = None
    repository_commit: Annotated[str, Field(max_length=128)] = ""
    source_document_id: UUID | None = None
    metadata_provenance: list[BibliographyProvenance] = Field(default_factory=list, max_length=40)
    metadata_suggestions: list[BibliographyMetadataSuggestion] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def validate_provenance_unique(self):
        fields = [item.field for item in self.metadata_provenance]
        if len(fields) != len(set(fields)):
            raise ValueError("metadata provenance must have unique fields")
        if self.url:
            parts = urlsplit(self.url)
            if parts.scheme not in {"http", "https"} or not parts.netloc:
                raise ValueError("url must be an absolute HTTP(S) URL")
        if self.doi and not self.doi.lower().removeprefix("https://doi.org/").removeprefix("doi:").strip():
            raise ValueError("doi must contain an identifier")
        if self.isbn and not is_valid_isbn(self.isbn):
            raise ValueError("isbn must be a valid ISBN-10 or ISBN-13")
        return self


def is_valid_isbn(value: str) -> bool:
    isbn = "".join(char for char in value.upper() if char not in "- ")
    if len(isbn) == 10 and isbn[:9].isdigit() and (isbn[9].isdigit() or isbn[9] == "X"):
        total = sum((10 - index) * (10 if char == "X" else int(char)) for index, char in enumerate(isbn))
        return total % 11 == 0
    if len(isbn) == 13 and isbn.isdigit():
        return sum(int(char) * (1 if index % 2 == 0 else 3) for index, char in enumerate(isbn)) % 10 == 0
    return False


class BibliographyItemUpdate(BibliographyItemInput):
    expected_revision: Annotated[int, Field(gt=0)]


class BibliographyItemResponse(BibliographyItemInput):
    id: UUID
    revision: Annotated[int, Field(gt=0)]
    created_at: datetime
    updated_at: datetime


class BibliographyListResponse(Contract):
    items: list[BibliographyItemResponse] = Field(max_length=100)
    limit: Annotated[int, Field(ge=1, le=100)]
    offset: Annotated[int, Field(ge=0)]
    total_count: Annotated[int, Field(ge=0)]


class LibraryDocumentResponse(Contract):
    id: UUID
    title: Annotated[str, Field(min_length=1, max_length=500)]


class LibraryDocumentListResponse(Contract):
    documents: list[LibraryDocumentResponse] = Field(max_length=100)
    limit: Annotated[int, Field(ge=1, le=100)]
    offset: Annotated[int, Field(ge=0)]
    total_count: Annotated[int, Field(ge=0)]


class BibliographyDeleteResponse(Contract):
    id: UUID
    deleted: Literal[True] = True
