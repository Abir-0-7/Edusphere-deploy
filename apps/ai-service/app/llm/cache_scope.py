"""Trusted feature/source context for private response reuse, never request input."""

import hashlib
import json
import logging
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, dataclass

from app.documents.store import DocumentRecord
from app.llm.admission import current_ai_owner
from app.llm.response_cache import ScopedResponseCache

logger = logging.getLogger("studyvault.llm.cache")


@dataclass(frozen=True)
class ResponseScope:
    namespace: str
    document_id: str | None
    source_revision: str | None
    schema_version: str
    variant: str
    language: str
    generation_run_id: str | None = None


_scope: ContextVar[ResponseScope | None] = ContextVar("response_cache_scope", default=None)
_candidate: ContextVar[tuple[Callable[[str, str], None], str, str] | None] = ContextVar(
    "response_cache_candidate", default=None
)


def current_response_scope() -> ResponseScope | None:
    return _scope.get()


def scope_payload(scope: ResponseScope) -> dict:
    """Keep existing operation/cache keys stable for non-generation callers."""
    payload = asdict(scope)
    if scope.generation_run_id is None:
        payload.pop("generation_run_id")
    return payload


def build_response_scope(
    namespace: str,
    document: DocumentRecord | None = None,
    *,
    schema_version: str = "1",
    variant: str = "default",
    language: str = "source",
) -> ResponseScope:
    """Build a trusted scope value for long-lived async streams."""
    if not namespace or not schema_version or not language:
        raise ValueError("response cache scope requires feature, schema version and language")
    revision = None
    document_id = getattr(document, "id", None) if document is not None else None
    if document is not None:
        owner = current_ai_owner()
        source_owner = getattr(document, "user_id", owner)
        if owner is not None and source_owner != owner:
            raise ValueError("response cache source does not belong to the authenticated owner")
        payload = {
            "markdown": getattr(document, "markdown", None),
            "chapters": [asdict(chapter) for chapter in getattr(document, "chapters", [])],
            "chunks": [asdict(chunk) for chunk in getattr(document, "chunks", [])],
        }
        revision = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return ResponseScope(namespace, document_id, revision, schema_version, variant, language)


@contextmanager
def response_scope(
    namespace: str,
    document: DocumentRecord | None = None,
    *,
    schema_version: str = "1",
    variant: str = "default",
    language: str = "source",
    generation_run_id: str | None = None,
) -> Iterator[None]:
    """Snapshot actual source text/locators so changed inputs cannot reuse old answers.

    The feature authorizes its source before opening this scope; the durable cache
    checks the owner/document again on reads/writes and cascades on source deletion.
    """
    scope = build_response_scope(
        namespace,
        document,
        schema_version=schema_version,
        variant=variant,
        language=language,
    )
    if generation_run_id is not None:
        from dataclasses import replace

        scope = replace(scope, generation_run_id=generation_run_id)
    token = _scope.set(scope)
    candidate_token = _candidate.set(None)
    try:
        yield
    finally:
        _candidate.reset(candidate_token)
        _scope.reset(token)


def clear_cache_candidate() -> None:
    _candidate.set(None)


def stage_cache_candidate(put: Callable[[str, str], None], key: str, value: str) -> None:
    if current_response_scope() is not None:
        _candidate.set((put, key, value))


def accept_cache_candidate() -> None:
    """Persist only the last completion after its feature has accepted it."""
    candidate = _candidate.get()
    _candidate.set(None)
    if candidate is None:
        return
    put, key, value = candidate
    put(key, value)


class PrivateResponseCache:
    """Bind explicit durable ownership to the router's get/put contract.

    Cache outages are a miss, followed by normal authoritative admission. They
    cannot grant free provider calls or discard a successful provider response.
    Unscoped callers are not cached. No raw source text or answers enter logs.
    """

    cache_after_validation = True

    def __init__(self, store: ScopedResponseCache, ttl_seconds: int) -> None:
        self.store = store
        self.ttl_seconds = ttl_seconds

    def get(self, key: str) -> str | None:
        owner, scope = current_ai_owner(), current_response_scope()
        if not owner or scope is None:
            return None
        try:
            extra = {"generation_run_id": scope.generation_run_id} if scope.generation_run_id else {}
            return self.store.get(owner, key, scope.document_id, **extra)
        except Exception as exc:  # noqa: BLE001 - cache is optional, admission is not
            logger.warning("response cache read unavailable: %s", type(exc).__name__)
            return None

    def put(self, key: str, value: str) -> None:
        owner, scope = current_ai_owner(), current_response_scope()
        if not owner or scope is None:
            return
        try:
            extra = {"generation_run_id": scope.generation_run_id} if scope.generation_run_id else {}
            self.store.put(owner, key, value, self.ttl_seconds, scope.document_id, **extra)
        except Exception as exc:  # noqa: BLE001 - a cache outage must not lose successful work
            logger.warning("response cache write unavailable: %s", type(exc).__name__)
