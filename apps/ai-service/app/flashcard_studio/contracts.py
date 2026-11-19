"""Flashcard Studio wire contracts, mirrored by the shared Zod schemas."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Revision = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Topic = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
DeckName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Front = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Back = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]
Quote = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Nonnegative = Annotated[int, Field(strict=True, ge=0)]


class StudioContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


def unique_ids(values: list[UUID]) -> list[UUID]:
    if len(set(values)) != len(values):
        raise ValueError("IDs must be unique")
    return values


class GenerationSettings(StudioContract):
    chapter_ids: list[UUID] = Field(min_length=1, max_length=12)
    topic: Topic | None = None
    language: Literal["en", "bn"]
    difficulty: Literal["basic", "intermediate", "advanced"]
    count: Annotated[int, Field(strict=True, ge=1, le=20)]

    _unique_chapters = field_validator("chapter_ids")(unique_ids)


class GenerationQueued(StudioContract):
    job_id: UUID
    draft_id: UUID


class ProposedCard(StudioContract):
    source_chunk_id: UUID
    source_quote: Quote
    front: Front
    back: Back


class ProposedCards(StudioContract):
    cards: list[ProposedCard] = Field(min_length=1, max_length=20)


class DraftCard(ProposedCard):
    id: UUID
    chapter_id: UUID
    page: Annotated[int, Field(strict=True, ge=1)] | None


class ReplaceCard(StudioContract):
    card_id: UUID
    draft_card_id: UUID


class MergeDraftRequest(StudioContract):
    card_ids: list[UUID] = Field(min_length=1, max_length=20)
    deck_name: DeckName | None = None
    replacements: list[ReplaceCard] = Field(default_factory=list, max_length=20)

    _unique_cards = field_validator("card_ids")(unique_ids)

    @model_validator(mode="after")
    def validate_replacements(self):
        draft_ids = [item.draft_card_id for item in self.replacements]
        card_ids = [item.card_id for item in self.replacements]
        if len(set(draft_ids)) != len(draft_ids) or len(set(card_ids)) != len(card_ids):
            raise ValueError("replacement card IDs must be unique")
        if not set(draft_ids) <= set(self.card_ids):
            raise ValueError("replacement candidates must be selected for merge")
        return self


class MergeResult(StudioContract):
    deck_id: UUID
    added_count: Nonnegative
    updated_count: Nonnegative = 0


class GenerationDraft(StudioContract):
    id: UUID
    source_revision: Revision
    settings: GenerationSettings
    cards: list[DraftCard] = Field(min_length=1, max_length=20)
    merge_result: MergeResult | None = None


class DeckSummary(StudioContract):
    id: UUID
    name: DeckName
    is_default: bool
    card_count: Nonnegative
