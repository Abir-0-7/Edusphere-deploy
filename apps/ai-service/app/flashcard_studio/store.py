"""Private storage and explicit acceptance of versioned flashcard drafts."""

import json
import threading
import unicodedata
from contextlib import nullcontext
from datetime import UTC, datetime
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from app.documents.store import DocumentRecord, InMemoryDocumentStore, _source_revision
from app.errors import InvalidInput, NotFound
from app.flashcard_studio.contracts import (
    DeckSummary,
    DraftCard,
    GenerationDraft,
    MergeDraftRequest,
    MergeResult,
)
from app.flashcard_studio.source import source_revision, validate_evidence
from app.jobs.worker import current_claim


def _normal(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def _identity(value: str | UUID) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise InvalidInput("Flashcard identifiers must be UUIDs") from exc


def _memory_owner(value: str) -> str:
    if not value.strip():
        raise InvalidInput("Flashcard owner is required")
    return value


def _draft(value: GenerationDraft | dict[str, Any]) -> GenerationDraft:
    try:
        return value if isinstance(value, GenerationDraft) else GenerationDraft.model_validate(value)
    except Exception as exc:
        raise InvalidInput("Flashcard draft is invalid") from exc


def _request(value: MergeDraftRequest | dict[str, Any]) -> MergeDraftRequest:
    try:
        return value if isinstance(value, MergeDraftRequest) else MergeDraftRequest.model_validate(value)
    except Exception as exc:
        raise InvalidInput("Flashcard merge request is invalid") from exc


def _card_json(card: DraftCard) -> dict[str, Any]:
    return card.model_dump(mode="json")


def _card_source_revision(document: DocumentRecord, card: DraftCard) -> str:
    """Pin a saved card to the exact chunk/quote contract used by legacy cards."""
    chunk = next(
        (item for item in document.chunks if item.id == str(card.source_chunk_id)),
        None,
    )
    if chunk is None:
        raise InvalidInput("Flashcard source chunk is unavailable")
    return _source_revision(
        document.id, str(card.chapter_id), str(card.source_chunk_id), chunk.content, card.source_quote
    )


def _decode_draft(
    draft_id: str, revision: str, settings: dict[str, Any], cards: Any, merge_result: Any, selected_ids: Any
) -> GenerationDraft:
    data = cards if isinstance(cards, list) else json.loads(cards)
    parsed = [DraftCard.model_validate(item) for item in data]
    if isinstance(merge_result, str):
        merge_result = json.loads(merge_result)
    if isinstance(merge_result, dict):
        merge_result = {
            key: merge_result[key]
            for key in ("deck_id", "added_count", "updated_count")
            if key in merge_result
        }
    merged = MergeResult.model_validate(merge_result) if merge_result is not None else None
    return GenerationDraft(
        id=UUID(draft_id),
        source_revision=revision,
        settings=settings if not isinstance(settings, str) else json.loads(settings),
        cards=parsed,
        merge_result=merged,
    )


def _claim_fence(owner_id: str, document_id: str, draft_id: str):
    """Return a transaction fence for a worker write, or a no-op for test/direct use."""
    claim = current_claim.get()
    if claim is None:
        return nullcontext(None)
    if claim.job.id != draft_id or claim.job.payload.get("user_id") != owner_id:
        raise NotFound("Flashcard draft not found")
    if claim.job.payload.get("document_id") != document_id:
        raise NotFound("Flashcard draft not found")
    return claim.store.publication(claim.job.id, claim.job.lease_token, claim.clock())


def _memory_deck_id(owner_id: str, document_id: str, name: str, is_default: bool) -> str:
    return str(uuid5(NAMESPACE_URL, f"studyvault:deck:{owner_id}:{document_id}:{is_default}:{name}"))


class MemoryFlashcardStudioStore:
    """Lock-protected in-memory implementation matching the Postgres protocol."""

    def __init__(self, documents: InMemoryDocumentStore) -> None:
        self.documents = documents
        self._lock = documents._lock
        self._decks: dict[tuple[str, str, str, bool], dict[str, Any]] = {}
        self._drafts: dict[tuple[str, str, str], dict[str, Any]] = {}

    def get_draft(self, document_id: str, user_id: str, draft_id: str) -> GenerationDraft:
        key = (_identity(document_id), _memory_owner(user_id), _identity(draft_id))
        with self._lock:
            row = self._drafts.get(key)
            if row is None:
                raise NotFound("Flashcard draft not found")
            return _decode_draft(
                row["id"],
                row["source_revision"],
                row["settings"],
                row["cards"],
                row["merge_result"],
                row["selected_ids"],
            )

    def save_draft(self, document_id: str, user_id: str, draft: GenerationDraft) -> None:
        document_id, user_id = _identity(document_id), _memory_owner(user_id)
        draft = _draft(draft)
        key = (document_id, user_id, str(draft.id))
        with self._lock, _claim_fence(user_id, document_id, str(draft.id)):
            doc = self.documents.get_for_user(document_id, user_id)
            if doc is None:
                raise NotFound("Source not found")
            if key in self._drafts:
                existing = self._drafts[key]
                if (
                    existing["source_revision"] == draft.source_revision
                    and existing["cards"] == [_card_json(card) for card in draft.cards]
                    and existing["settings"] == draft.settings.model_dump(mode="json")
                ):
                    return
                raise InvalidInput("Flashcard draft identifier is already in use", status_code=409)
            current = source_revision(doc, draft.settings)
            if current != draft.source_revision:
                raise InvalidInput("Source changed during generation; start a new draft", status_code=409)
            validate_evidence(doc, draft.cards)
            self._drafts[key] = {
                "id": str(draft.id),
                "source_revision": draft.source_revision,
                "settings": draft.settings.model_dump(mode="json"),
                "cards": [_card_json(card) for card in draft.cards],
                "merge_result": None,
                "selected_ids": None,
            }

    def list_decks(self, document_id: str, user_id: str) -> list[DeckSummary]:
        document_id, user_id = _identity(document_id), _memory_owner(user_id)
        with self._lock:
            if self.documents.get_for_user(document_id, user_id) is None:
                raise NotFound("Source not found")
            result = []
            default_key = (user_id, document_id, "Default", True)
            default_row = self._decks.setdefault(
                default_key,
                {
                    "id": _memory_deck_id(user_id, document_id, "Default", True),
                    "name": "Default",
                },
            )
            legacy_cards = self.documents._flashcards.setdefault((document_id, user_id), [])
            for card in legacy_cards:
                card.setdefault("deck_id", default_row["id"])
            for (owner, document, _name, default), row in self._decks.items():
                if owner == user_id and document == document_id:
                    result.append(
                        DeckSummary(
                            id=row["id"],
                            name=row["name"],
                            is_default=default,
                            card_count=sum(card.get("deck_id") == row["id"] for card in legacy_cards),
                        )
                    )
            return sorted(result, key=lambda deck: (not deck.is_default, deck.name.casefold()))

    def merge_draft(self, document_id: str, user_id: str, draft_id: str, request: MergeDraftRequest) -> MergeResult:
        document_id, user_id, draft_id = _identity(document_id), _memory_owner(user_id), _identity(draft_id)
        request = _request(request)
        with self._lock, _claim_fence(user_id, document_id, draft_id):
            doc = self.documents.get_for_user(document_id, user_id)
            if doc is None:
                raise NotFound("Source not found")
            key = (document_id, user_id, draft_id)
            row = self._drafts.get(key)
            if row is None:
                raise NotFound("Flashcard draft not found")
            selected = sorted(str(value) for value in request.card_ids)
            deck_key = (user_id, document_id, request.deck_name or "Default", request.deck_name is None)
            deck_name = request.deck_name or "Default"
            if row["merge_result"] is not None:
                replacement_map = sorted(
                    (str(item.card_id), str(item.draft_card_id)) for item in request.replacements
                )
                if (
                    row["selected_ids"] != selected
                    or row["deck_name"] != deck_name
                    or row["is_default"] != (request.deck_name is None)
                    or row.get("replacement_map", []) != replacement_map
                ):
                    raise InvalidInput("This draft was already merged with different choices", status_code=409)
                return MergeResult.model_validate(row["merge_result"])
            from app.flashcard_studio.contracts import GenerationSettings

            settings = GenerationSettings.model_validate(row["settings"])
            if source_revision(doc, settings) != row["source_revision"]:
                raise InvalidInput("The source changed; generate a new draft before merging", status_code=409)
            cards = [DraftCard.model_validate(item) for item in row["cards"]]
            validate_evidence(doc, cards)
            by_id = {str(card.id): card for card in cards}
            if not set(selected) <= by_id.keys():
                raise InvalidInput("Select only cards from this draft")
            if request.replacements:
                if request.deck_name is not None:
                    raise InvalidInput("Regenerated cards remain in their original deck")
                # Legacy cards created before deck persistence are migrated
                # lazily into the owner's deterministic default deck before
                # replacement validation. This keeps their IDs and schedules
                # while making the saved-deck invariant explicit.
                default_deck_id = _memory_deck_id(user_id, document_id, "Default", True)
                for existing in self.documents._flashcards.get((document_id, user_id), []):
                    existing.setdefault("deck_id", default_deck_id)
                replacement_by_target = {
                    str(item.card_id): by_id[str(item.draft_card_id)] for item in request.replacements
                }
                target_cards = {}
                for target_id in replacement_by_target:
                    target_card = self.documents.get_flashcard_for_user(target_id, user_id)
                    if (
                        target_card is None
                        or target_card.get("document_id") != document_id
                        or target_card.get("status", "active") != "active"
                    ):
                        raise NotFound("flashcard not found")
                    target_cards[target_id] = target_card
                deck_ids = {target_card.get("deck_id") for target_card in target_cards.values()}
                if len(deck_ids) != 1 or None in deck_ids:
                    raise InvalidInput("Regenerated cards must belong to one saved deck")
                target_ids = set(target_cards)
                other_questions = {
                    _normal(target["front"])
                    for target in self.documents._flashcards.get((document_id, user_id), [])
                    if target.get("deck_id") in deck_ids and target["id"] not in target_ids
                }
                new_questions: set[str] = set()
                for replacement in replacement_by_target.values():
                    question = _normal(replacement.front)
                    if question in other_questions or question in new_questions:
                        raise InvalidInput("Regenerated cards must keep questions unique within the deck")
                    new_questions.add(question)
                replacement_draft_ids = {str(item.draft_card_id) for item in request.replacements}
                additions = []
                global_ids = {
                    card["id"] for cards_for_source in self.documents._flashcards.values() for card in cards_for_source
                }
                for card_id in selected:
                    if card_id in replacement_draft_ids:
                        continue
                    card = by_id[card_id]
                    question = _normal(card.front)
                    if question in other_questions or question in new_questions:
                        raise InvalidInput("Regenerated cards must keep questions unique within the deck")
                    if card_id in global_ids:
                        raise InvalidInput("Card identifier is already in use")
                    new_questions.add(question)
                    additions.append(card)
                target_rows = self.documents._flashcards.get((document_id, user_id), [])
                deck_card_count = sum(row.get("deck_id") in deck_ids for row in target_rows)
                if deck_card_count + len(additions) > self.documents._max_flashcards_per_deck:
                    raise InvalidInput("flashcard deck limit reached")
                for target_id, replacement in replacement_by_target.items():
                    target = target_cards[target_id]
                    self.documents._snapshot_card(target)
                    target.update({
                        "front": replacement.front,
                        "back": replacement.back,
                        "chapter_id": str(replacement.chapter_id),
                        "source_chunk_id": str(replacement.source_chunk_id),
                        "source_quote": replacement.source_quote,
                        "source_revision": _card_source_revision(doc, replacement),
                        "needs_review": True,
                        "due_date": datetime.now(UTC).date().isoformat(),
                    })
                    versions = self.documents._flashcard_versions[target_id]
                    versions.append({
                        "version": len(versions) + 1,
                        "front": target["front"],
                        "back": target["back"],
                        "chapter_id": target.get("chapter_id"),
                        "source_chunk_id": target.get("source_chunk_id"),
                        "source_quote": target.get("source_quote"),
                        "source_revision": target.get("source_revision"),
                        "tags": list(target.get("tags", [])),
                    })
                for card in additions:
                    added = {
                        "id": str(card.id), "document_id": document_id, "user_id": user_id,
                        "deck_id": next(iter(deck_ids)), "chapter_id": str(card.chapter_id),
                        "source_chunk_id": str(card.source_chunk_id), "source_quote": card.source_quote,
                        "source_revision": _card_source_revision(doc, card), "front": card.front, "back": card.back,
                        "ease_factor": 2.5, "interval_days": 0, "repetitions": 0,
                        "due_date": datetime.now(UTC).date().isoformat(), "tags": [],
                        "status": "active", "needs_review": False,
                    }
                    target_rows.append(added)
                    self.documents._snapshot_card(added)
                deck_id = next(iter(deck_ids))
                replacement_map = sorted(
                    (str(item.card_id), str(item.draft_card_id)) for item in request.replacements
                )
                result = MergeResult(
                    deck_id=UUID(deck_id), added_count=len(additions), updated_count=len(replacement_map)
                )
                row["selected_ids"] = selected
                row["deck_name"] = "Default"
                row["is_default"] = True
                row["replacement_map"] = replacement_map
                row["merge_result"] = result.model_dump(mode="json")
                return result
            existing_deck = self._decks.get(deck_key)
            if existing_deck is None:
                deck = {
                    "id": _memory_deck_id(user_id, document_id, deck_name, request.deck_name is None),
                    "name": deck_name,
                }
                self._decks[deck_key] = deck
            else:
                deck = existing_deck
                if deck["name"] != deck_name:
                    raise InvalidInput("Deck name conflicts with an existing deck", status_code=409)
            target = self.documents._flashcards.setdefault((document_id, user_id), [])
            default_deck_id = _memory_deck_id(user_id, document_id, "Default", True)
            for existing in target:
                existing.setdefault("deck_id", default_deck_id)
            questions = {(_normal(card["front"])) for card in target if card["deck_id"] == deck["id"]}
            global_ids = {
                card["id"] for cards_for_source in self.documents._flashcards.values() for card in cards_for_source
            }
            additions = []
            now = datetime.now(UTC).date().isoformat()
            for card_id in selected:
                card = by_id[card_id]
                question = _normal(card.front)
                if question in questions:
                    continue
                if card_id in global_ids:
                    raise InvalidInput("Card identifier is already in use")
                questions.add(question)
                added = {
                    "id": str(card.id),
                    "document_id": document_id,
                    "user_id": user_id,
                    "deck_id": deck["id"],
                    "chapter_id": str(card.chapter_id),
                    "source_chunk_id": str(card.source_chunk_id),
                    "source_quote": card.source_quote,
                    "source_revision": _card_source_revision(doc, card),
                    "front": card.front,
                    "back": card.back,
                    "ease_factor": 2.5,
                    "interval_days": 0,
                    "repetitions": 0,
                    "due_date": now,
                    "tags": [],
                    "status": "active",
                    "needs_review": False,
                }
                additions.append(added)
            existing_count = sum(card.get("deck_id") == deck["id"] for card in target)
            if existing_count + len(additions) > self.documents._max_flashcards_per_deck:
                raise InvalidInput("flashcard deck limit reached")
            target.extend(additions)
            for added in additions:
                self.documents._snapshot_card(added)
            result = MergeResult(deck_id=UUID(deck["id"]), added_count=len(additions))
            row["selected_ids"] = selected
            row["deck_name"] = deck_name
            row["is_default"] = request.deck_name is None
            row["merge_result"] = result.model_dump(mode="json")
            return result


class PgFlashcardStudioStore:
    """Postgres implementation; source evidence and SM-2 state share one transaction."""

    def __init__(self, database_url: str, *, max_flashcards_per_deck: int = 2000) -> None:
        import psycopg

        if type(max_flashcards_per_deck) is not int or max_flashcards_per_deck <= 0:
            raise ValueError("flashcard deck limit must be a positive integer")
        self._database_url = database_url
        self._max_flashcards_per_deck = max_flashcards_per_deck
        self._conn = psycopg.connect(database_url, autocommit=True)
        self._lock = threading.RLock()

    def _connect_for_atomic(self):
        import psycopg

        return psycopg.connect(self._database_url, autocommit=True, connect_timeout=5)

    @staticmethod
    def _load_source(cur, document_id: str, user_id: str) -> DocumentRecord:
        from app.documents.pg_store import _chapter, _chunk, _doc

        cur.execute("SELECT id FROM users WHERE id=%s FOR KEY SHARE", (user_id,))
        if cur.fetchone() is None:
            raise NotFound("Source not found")
        cur.execute(
            "SELECT id,user_id,filename,mime_type,size_bytes,page_count,status,markdown,error_reason "
            "FROM documents WHERE id=%s AND user_id=%s FOR UPDATE",
            (document_id, user_id),
        )
        row = cur.fetchone()
        if row is None:
            raise NotFound("Source not found")
        doc = _doc(row)
        cur.execute(
            "SELECT id,document_id,user_id,title,ordinal,start_page,end_page FROM chapters "
            "WHERE document_id=%s AND user_id=%s ORDER BY ordinal,id FOR SHARE",
            (document_id, user_id),
        )
        doc.chapters = [_chapter(row) for row in cur.fetchall()]
        cur.execute(
            "SELECT id,document_id,user_id,chapter_id,content,page,ordinal FROM chunks "
            "WHERE document_id=%s AND user_id=%s ORDER BY ordinal,id FOR SHARE",
            (document_id, user_id),
        )
        doc.chunks = [_chunk(row) for row in cur.fetchall()]
        return doc

    def get_draft(self, document_id: str, user_id: str, draft_id: str) -> GenerationDraft:
        document_id, user_id, draft_id = _identity(document_id), _identity(user_id), _identity(draft_id)
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id,source_revision,settings,cards,merge_result,selected_ids "
                "FROM flashcard_generation_drafts WHERE id=%s AND document_id=%s AND user_id=%s",
                (draft_id, document_id, user_id),
            )
            row = cur.fetchone()
        if row is None:
            raise NotFound("Flashcard draft not found")
        try:
            return _decode_draft(*row)
        except Exception as exc:
            raise InvalidInput("Saved flashcard draft is invalid") from exc

    def save_draft(self, document_id: str, user_id: str, draft: GenerationDraft) -> None:
        document_id, user_id = _identity(document_id), _identity(user_id)
        draft = _draft(draft)
        claim = current_claim.get()
        token = claim.job.lease_token if claim else None
        now = claim.clock() if claim else datetime.now(UTC)
        with self._lock, self._connect_for_atomic() as conn, conn.transaction(), conn.cursor() as cur:
            if claim is not None:
                if (
                    claim.job.id != str(draft.id)
                    or claim.job.payload.get("document_id") != document_id
                    or claim.job.payload.get("user_id") != user_id
                ):
                    raise NotFound("Flashcard draft not found")
                cur.execute("SELECT clerk_id FROM users WHERE id=%s FOR KEY SHARE", (user_id,))
                if cur.fetchone() is None:
                    raise NotFound("Source not found")
                cur.execute(
                    "SELECT id FROM jobs WHERE id=%s AND status='running' AND NOT cancel_requested "
                    "AND lease_token=%s AND lease_expires_at>%s FOR UPDATE",
                    (str(claim.job.id), token, now),
                )
                if cur.fetchone() is None:
                    from app.jobs.postgres_store import LeaseLost

                    raise LeaseLost("Cannot save a draft with an expired or cancelled claim")
            doc = self._load_source(cur, document_id, user_id)
            if source_revision(doc, draft.settings) != draft.source_revision:
                raise InvalidInput("Source changed during generation; start a new draft", status_code=409)
            validate_evidence(doc, draft.cards)
            cards = json.dumps([_card_json(card) for card in draft.cards], ensure_ascii=False)
            settings = json.dumps(draft.settings.model_dump(mode="json"), ensure_ascii=False)
            cur.execute(
                "INSERT INTO flashcard_generation_drafts "
                "(id,user_id,document_id,source_revision,settings,cards) VALUES (%s,%s,%s,%s,%s::jsonb,%s::jsonb) "
                "ON CONFLICT (id) DO NOTHING",
                (str(draft.id), user_id, document_id, draft.source_revision, settings, cards),
            )
            if cur.rowcount == 0:
                cur.execute(
                    "SELECT source_revision,settings,cards FROM flashcard_generation_drafts "
                    "WHERE id=%s AND user_id=%s AND document_id=%s FOR UPDATE",
                    (str(draft.id), user_id, document_id),
                )
                old = cur.fetchone()
                if (
                    old is None
                    or old[0] != draft.source_revision
                    or old[1] != draft.settings.model_dump(mode="json")
                    or old[2] != [_card_json(card) for card in draft.cards]
                ):
                    raise InvalidInput("Flashcard draft identifier is already in use", status_code=409)

    def list_decks(self, document_id: str, user_id: str) -> list[DeckSummary]:
        document_id, user_id = _identity(document_id), _identity(user_id)
        with self._connect_for_atomic() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s FOR KEY SHARE", (user_id,))
            if cur.fetchone() is None:
                raise NotFound("Source not found")
            cur.execute("SELECT id FROM documents WHERE id=%s AND user_id=%s FOR UPDATE", (document_id, user_id))
            if cur.fetchone() is None:
                raise NotFound("Source not found")
            cur.execute(
                "INSERT INTO flashcard_decks (user_id,document_id,name,is_default) VALUES (%s,%s,'Default',true) "
                "ON CONFLICT (user_id,document_id) WHERE is_default DO NOTHING",
                (user_id, document_id),
            )
            cur.execute(
                "SELECT d.id,d.name,d.is_default,count(f.id) FROM flashcard_decks AS d "
                "LEFT JOIN flashcards AS f ON f.deck_id=d.id AND f.document_id=d.document_id AND f.user_id=d.user_id "
                "WHERE d.document_id=%s AND d.user_id=%s GROUP BY d.id,d.name,d.is_default "
                "ORDER BY d.is_default DESC,lower(d.name),d.id",
                (document_id, user_id),
            )
            return [DeckSummary(id=row[0], name=row[1], is_default=row[2], card_count=row[3]) for row in cur.fetchall()]

    def merge_draft(self, document_id: str, user_id: str, draft_id: str, request: MergeDraftRequest) -> MergeResult:
        document_id, user_id, draft_id = _identity(document_id), _identity(user_id), _identity(draft_id)
        request = _request(request)
        selected = sorted(str(value) for value in request.card_ids)
        name = request.deck_name or "Default"
        default = request.deck_name is None
        with self._lock, self._connect_for_atomic() as conn, conn.transaction(), conn.cursor() as cur:
            doc = self._load_source(cur, document_id, user_id)
            cur.execute(
                "SELECT source_revision,settings,cards,merge_result,selected_ids "
                "FROM flashcard_generation_drafts WHERE id=%s AND document_id=%s AND user_id=%s FOR UPDATE",
                (draft_id, document_id, user_id),
            )
            row = cur.fetchone()
            if row is None:
                raise NotFound("Flashcard draft not found")
            revision, settings, raw_cards, old_result, old_selected = row
            cards = raw_cards if isinstance(raw_cards, list) else json.loads(raw_cards)
            parsed_cards = [DraftCard.model_validate(item) for item in cards]
            if old_result is not None:
                previous = old_selected if isinstance(old_selected, (list, dict)) else json.loads(old_selected)
                previous_ids = previous.get("card_ids", []) if isinstance(previous, dict) else previous
                previous_name = previous.get("deck_name", "Default") if isinstance(previous, dict) else "Default"
                previous_default = previous.get("is_default", True) if isinstance(previous, dict) else True
                previous_replacements = previous.get("replacements", []) if isinstance(previous, dict) else []
                request_replacements = sorted(
                    (str(item.card_id), str(item.draft_card_id)) for item in request.replacements
                )
                if previous_ids != selected:
                    raise InvalidInput("This draft was already merged with different choices", status_code=409)
                if (
                    previous_name != name
                    or previous_default != default
                    or previous_replacements != request_replacements
                ):
                    raise InvalidInput("This draft was already merged into another deck", status_code=409)
                return MergeResult.model_validate(
                    old_result if isinstance(old_result, dict) else json.loads(old_result)
                )
            selected_settings = settings if not isinstance(settings, str) else json.loads(settings)
            from app.flashcard_studio.contracts import GenerationSettings

            generation_settings = GenerationSettings.model_validate(selected_settings)
            if source_revision(doc, generation_settings) != revision:
                raise InvalidInput("The source changed; generate a new draft before merging", status_code=409)
            validate_evidence(doc, parsed_cards)
            by_id = {str(card.id): card for card in parsed_cards}
            if not set(selected) <= by_id.keys():
                raise InvalidInput("Select only cards from this draft")
            card_by_id = [by_id[card_id] for card_id in selected]
            if request.replacements:
                if request.deck_name is not None:
                    raise InvalidInput("Regenerated cards remain in their original deck")
                replacement_by_target = {
                    str(item.card_id): by_id[str(item.draft_card_id)] for item in request.replacements
                }
                target_cards = {}
                for target_id in replacement_by_target:
                    cur.execute(
                        "SELECT id,deck_id,front,status FROM flashcards "
                        "WHERE id=%s AND document_id=%s AND user_id=%s FOR UPDATE",
                        (target_id, document_id, user_id),
                    )
                    target = cur.fetchone()
                    if target is None or target[3] != "active":
                        raise NotFound("flashcard not found")
                    target_cards[target_id] = target
                deck_ids = {str(target[1]) for target in target_cards.values()}
                if len(deck_ids) != 1:
                    raise InvalidInput("Regenerated cards must belong to one saved deck")
                deck_id = next(iter(deck_ids))
                cur.execute(
                    "SELECT id,front FROM flashcards WHERE document_id=%s AND user_id=%s AND deck_id=%s "
                    "AND id <> ALL(%s::uuid[]) FOR UPDATE",
                    (document_id, user_id, deck_id, list(target_cards)),
                )
                questions = {_normal(front) for _, front in cur.fetchall()}
                replacement_questions = set()
                for replacement in replacement_by_target.values():
                    question = _normal(replacement.front)
                    if question in questions or question in replacement_questions:
                        raise InvalidInput("Regenerated cards must keep questions unique within the deck")
                    replacement_questions.add(question)
                replacement_draft_ids = {str(item.draft_card_id) for item in request.replacements}
                additions = []
                for card_id in selected:
                    if card_id in replacement_draft_ids:
                        continue
                    card = by_id[card_id]
                    question = _normal(card.front)
                    if question in questions or question in replacement_questions:
                        raise InvalidInput("Regenerated cards must keep questions unique within the deck")
                    cur.execute("SELECT EXISTS(SELECT 1 FROM flashcards WHERE id=%s)", (str(card.id),))
                    if cur.fetchone()[0]:
                        raise InvalidInput("Card identifier is already in use")
                    replacement_questions.add(question)
                    additions.append(card)
                cur.execute(
                    "SELECT count(*) FROM flashcards WHERE document_id=%s AND user_id=%s AND deck_id=%s",
                    (document_id, user_id, deck_id),
                )
                if cur.fetchone()[0] + len(additions) > self._max_flashcards_per_deck:
                    raise InvalidInput("flashcard deck limit reached")
                due_date = datetime.now(UTC).date().isoformat()
                for target_id, replacement in replacement_by_target.items():
                    cur.execute(
                        "UPDATE flashcards SET front=%s,back=%s,chapter_id=%s,source_chunk_id=%s,"
                        "source_quote=%s,source_revision=%s,needs_review=true,due_date=%s,updated_at=now() "
                        "WHERE id=%s AND document_id=%s AND user_id=%s AND status='active' RETURNING id",
                        (
                            replacement.front, replacement.back, str(replacement.chapter_id),
                            str(replacement.source_chunk_id), replacement.source_quote,
                            _card_source_revision(doc, replacement), due_date,
                            target_id, document_id, user_id,
                        ),
                    )
                    if cur.fetchone() is None:
                        raise NotFound("flashcard not found")
                for card in additions:
                    cur.execute(
                        "INSERT INTO flashcards (id,document_id,deck_id,chapter_id,source_chunk_id,source_quote,"
                        "source_revision,user_id,front,back,due_date) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (
                            str(card.id), document_id, deck_id, str(card.chapter_id), str(card.source_chunk_id),
                            card.source_quote, _card_source_revision(doc, card), user_id,
                            card.front, card.back, due_date,
                        ),
                    )
                replacement_map = sorted(
                    (str(item.card_id), str(item.draft_card_id)) for item in request.replacements
                )
                result = MergeResult(
                    deck_id=UUID(deck_id), added_count=len(additions), updated_count=len(replacement_map)
                )
                selection = {
                    "card_ids": selected,
                    "deck_name": name,
                    "is_default": default,
                    "replacements": replacement_map,
                }
                cur.execute(
                    "UPDATE flashcard_generation_drafts SET merge_result=%s::jsonb,selected_ids=%s::jsonb "
                    "WHERE id=%s AND document_id=%s AND user_id=%s AND merge_result IS NULL",
                    (
                        json.dumps(result.model_dump(mode="json")),
                        json.dumps(selection),
                        draft_id,
                        document_id,
                        user_id,
                    ),
                )
                if cur.rowcount != 1:
                    raise InvalidInput("Flashcard draft changed while regenerating", status_code=409)
                return result
            if default:
                cur.execute(
                    "INSERT INTO flashcard_decks (user_id,document_id,name,is_default) VALUES (%s,%s,'Default',true) "
                    "ON CONFLICT (user_id,document_id) WHERE is_default DO NOTHING",
                    (user_id, document_id),
                )
                cur.execute(
                    "SELECT id,name FROM flashcard_decks WHERE user_id=%s AND document_id=%s AND is_default FOR UPDATE",
                    (user_id, document_id),
                )
            else:
                cur.execute(
                    "INSERT INTO flashcard_decks (user_id,document_id,name,is_default) VALUES (%s,%s,%s,false) "
                    "ON CONFLICT (user_id,document_id,name) WHERE NOT is_default DO NOTHING",
                    (user_id, document_id, name),
                )
                cur.execute(
                    "SELECT id,name FROM flashcard_decks WHERE user_id=%s AND document_id=%s AND name=%s "
                    "AND NOT is_default FOR UPDATE",
                    (user_id, document_id, name),
                )
            deck_row = cur.fetchone()
            if deck_row is None:
                raise NotFound("Target deck not found")
            deck_id, saved_name = str(deck_row[0]), deck_row[1]
            if saved_name != name:
                raise InvalidInput("Deck name conflicts with an existing deck", status_code=409)
            cur.execute(
                "SELECT id,front FROM flashcards WHERE user_id=%s AND document_id=%s AND deck_id=%s FOR UPDATE",
                (user_id, document_id, deck_id),
            )
            existing_cards = cur.fetchall()
            question_ids = {_normal(front): str(card_id) for card_id, front in existing_cards}
            due_date = datetime.now(UTC).date().isoformat()
            added = 0
            for card in card_by_id:
                question = _normal(card.front)
                if question in question_ids:
                    continue
                if len(existing_cards) + added >= self._max_flashcards_per_deck:
                    raise InvalidInput("flashcard deck limit reached")
                cur.execute("SELECT EXISTS(SELECT 1 FROM flashcards WHERE id=%s)", (str(card.id),))
                if cur.fetchone()[0]:
                    raise InvalidInput("Card identifier is already in use")
                cur.execute(
                    "INSERT INTO flashcards (id,document_id,deck_id,chapter_id,source_chunk_id,source_quote,"
                    "source_revision,user_id,front,back,due_date) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                    (
                        str(card.id),
                        document_id,
                        deck_id,
                        str(card.chapter_id),
                        str(card.source_chunk_id),
                        card.source_quote,
                        _card_source_revision(doc, card),
                        user_id,
                        card.front,
                        card.back,
                        due_date,
                    ),
                )
                cur.fetchone()
                question_ids[question] = str(card.id)
                added += 1
            result = MergeResult(deck_id=UUID(deck_id), added_count=added)
            serialized_result = result.model_dump(mode="json")
            serialized_selection = {
                "card_ids": selected, "deck_name": name, "is_default": default, "replacements": [],
            }
            cur.execute(
                "UPDATE flashcard_generation_drafts SET merge_result=%s::jsonb,selected_ids=%s::jsonb "
                "WHERE id=%s AND document_id=%s AND user_id=%s AND merge_result IS NULL",
                (json.dumps(serialized_result), json.dumps(serialized_selection), draft_id, document_id, user_id),
            )
            if cur.rowcount != 1:
                raise InvalidInput("Flashcard draft changed while merging", status_code=409)
            return result

    def close(self) -> None:
        self._conn.close()
