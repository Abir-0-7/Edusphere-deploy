"""FastAPI app entrypoint.

Endpoints: /health, POST /api/parse-pdf, GET /api/jobs/{id}, GET /api/documents/{id}/chapters.
Ingest pipeline (Phase 2): parse_pdf job -> structure_chapters job (see app/pipeline.py).
"""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.ai.outline import Outline
from app.ai.structure import build_outline
from app.ai.summaries import LEVELS, stream_summary
from app.auth import TokenVerifier, verifier_from_settings
from app.documents.pg_store import PgDocumentStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, InvalidInput, NotFound, TooLarge, Unauthorized, api_error_handler, error_body
from app.jobs.postgres_store import PgJobStore
from app.jobs.worker import InMemoryJobStore, Job, JobStore, Worker
from app.llm.router import router_from_settings
from app.logging_config import configure_logging
from app.parsing.pages import Page
from app.parsing.pdf import TesseractOcrBackend, validate_pdf
from app.parsing.upload import read_bounded
from app.pipeline import (
    make_embed_handler,
    make_flashcard_handler,
    make_parse_handler,
    make_structure_handler,
)
from app.privacy import PrivacyStore
from app.rag.chat import answer_question
from app.rag.embeddings import embedder_from_settings
from app.settings import get_settings
from app.study.readiness import ReadinessInputs, breakdown
from app.study.store import FOCUS_KINDS, InMemoryStudyStore, PgStudyStore
from app.study.tokens import settle

logger = logging.getLogger("studyvault")

settings = get_settings()

# --- Observability (task 1.13) ----------------------------------------------
if settings.sentry_dsn:
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=settings.sentry_dsn, traces_sample_rate=0.2, data_collection={"user_info": False})
        logger.info("sentry initialised")
    except ImportError:  # deployment without the optional SDK: never crash the app over telemetry
        logger.warning("AI_SERVICE_SENTRY_DSN is set but sentry-sdk is not installed; Sentry disabled")

configure_logging(settings.log_level)


# --- Auth (task 1.10) -------------------------------------------------------
# Bearer tokens are verified by `verifier` (real Clerk JWKS, or the unsigned
# dev verifier when AI_SERVICE_JWT_DEV_MODE=true). The `sub` claim scopes all
# data to the caller.
verifier: TokenVerifier = verifier_from_settings(settings)


async def current_user_id(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized()
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise Unauthorized()
    subject = verifier.user_id(token)
    # Postgres rows are scoped by the internal users.id (uuid); the Clerk `sub`
    # is a string, so resolve it once per request. In-memory (dev/test) stores
    # keep the raw subject.
    if isinstance(documents, PgDocumentStore):
        return documents.resolve_user(subject)
    return subject


# --- Stores ------------------------------------------------------------------
# AI_SERVICE_JOB_STORE=postgres uses the Postgres jobs table (task 1.14);
# "auto" (default) tries Postgres and falls back to memory if unreachable.
# Tests pin "memory" so they never touch a real database. AI_SERVICE_JOB_STORE
# also gates the document store so tests can stay in memory.
def _job_store() -> JobStore:
    if settings.job_store == "memory":
        return InMemoryJobStore()
    try:
        return PgJobStore(settings.database_url)
    except Exception:  # noqa: BLE001 - fall back to in-memory if DB is unreachable at boot
        if settings.job_store == "postgres":
            raise
        logger.warning("postgres job store unavailable; falling back to in-memory", exc_info=True)
        return InMemoryJobStore()


job_store: JobStore = _job_store()
embedder = embedder_from_settings(settings)


def _document_store():
    # Postgres in production; in-memory for dev/tests (set AI_SERVICE_JOB_STORE=memory).
    if settings.job_store == "memory":
        return InMemoryDocumentStore()
    try:
        return PgDocumentStore(settings.database_url)
    except Exception:  # noqa: BLE001
        logger.warning("postgres document store unavailable; using in-memory", exc_info=True)
        return InMemoryDocumentStore()


documents = _document_store()


def enqueue(kind: str, payload: dict[str, Any]) -> str:
    job_id = str(uuid.uuid4())
    job_store.add(Job(id=job_id, kind=kind, payload={**payload, "job_id": job_id}))
    return job_id


def _ocr_backend() -> TesseractOcrBackend | None:
    if not settings.ocr_enabled:
        return None
    backend = TesseractOcrBackend(lang=settings.ocr_lang)
    if not backend.available:
        logger.warning("AI_SERVICE_OCR_ENABLED is true but tesseract is not on PATH; scanned pages will be skipped")
        return None
    return backend


llm_router = router_from_settings(settings)


def _study_store():
    if settings.job_store == "memory":
        return InMemoryStudyStore()
    try:
        return PgStudyStore(settings.database_url)
    except Exception:  # noqa: BLE001
        logger.warning("postgres study store unavailable; using in-memory", exc_info=True)
        return InMemoryStudyStore()


study = _study_store()


def _outline(pages: list[Page], page_count: int) -> tuple[list[Outline], str]:
    return build_outline(
        llm_router,
        pages,
        page_count,
        max_input_chars=settings.structure_max_input_chars,
        max_chapters=settings.max_chapters,
    )


worker = Worker(
    job_store,
    handlers={
        "parse_pdf": make_parse_handler(
            docs=documents, enqueue=enqueue, ocr=_ocr_backend(), max_pages=settings.max_pages
        ),
        "structure_chapters": make_structure_handler(
            docs=documents,
            outline_fn=_outline,
            chunk_max_chars=settings.chunk_max_chars,
            chunk_overlap_chars=settings.chunk_overlap_chars,
            enqueue=enqueue,
        ),
        "embed_chunks": make_embed_handler(docs=documents, embedder=embedder),
        "generate_flashcards": make_flashcard_handler(docs=documents, router=llm_router),
    },
)


async def _worker_loop() -> None:
    while True:
        try:
            processed = await asyncio.to_thread(worker.process_one)
        except Exception:  # noqa: BLE001 - keep the loop alive; error is logged with traceback
            logger.exception("worker loop iteration failed")
            processed = False
        if not processed:
            await asyncio.sleep(settings.worker_poll_seconds)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    task = asyncio.create_task(_worker_loop()) if settings.worker_enabled else None
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="StudyVault AI Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)
app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Any, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=400, content=error_body("Invalid request", "invalid_input", str(exc.errors())))


# Multipart overhead allowance on top of the file limit for the early Content-Length check.
_MULTIPART_SLACK_BYTES = 64 * 1024


@app.middleware("http")
async def reject_oversized_bodies(request: Request, call_next: Any) -> Response:
    """Reject declared-oversize uploads before the body is read (task 2.1)."""
    length = request.headers.get("content-length")
    limit = settings.max_upload_mb * 1024 * 1024 + _MULTIPART_SLACK_BYTES
    if length is not None and length.isdigit() and int(length) > limit:
        err = TooLarge(f"File exceeds the {settings.max_upload_mb} MB limit")
        return JSONResponse(status_code=err.status_code, content=error_body(err.message, err.code))
    response: Response = await call_next(request)
    return response


# --- Routes -----------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/parse-pdf", status_code=202)
async def parse_pdf_endpoint(
    file: UploadFile,
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, str]:
    if file.filename is None:
        raise InvalidInput("filename is required")
    data = await read_bounded(file, max_mb=settings.max_upload_mb)
    validate_pdf(
        data,
        file.filename,
        file.content_type,
        max_mb=settings.max_upload_mb,
        max_pages=settings.max_pages,
    )
    doc = documents.create(
        user_id=user_id,
        filename=file.filename[:255],
        mime_type="application/pdf",
        size_bytes=len(data),
        source_bytes=data,
    )
    # The job carries only ids: bytes live on the row until the parser reads them.
    job_id = enqueue("parse_pdf", {"user_id": user_id, "document_id": doc.id})
    return {"job_id": job_id, "document_id": doc.id}


@app.get("/api/jobs/{job_id}")
async def job_status(job_id: str, user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, Any]:
    job = job_store.get(job_id, user_id)
    if job is None:
        raise NotFound("job not found")
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "attempts": job.attempts,
        "error_reason": job.error_reason,
        "result": job.result,
    }


@app.post("/api/chapters/{chapter_id}/summary")
async def stream_chapter_summary(
    chapter_id: str,
    body: dict[str, Any],
    user_id: Annotated[str, Depends(current_user_id)],
) -> StreamingResponse:
    """Streamed chapter summary (tasks 2.5, 2.6). SSE: token events, then one
    `done` event carrying the saved summary id."""
    level = str((body or {}).get("level", "")).strip()
    if level not in LEVELS:
        raise InvalidInput("level must be one of: standard, eli5, deep_dive")
    found = documents.get_chapter_for_user(chapter_id, user_id)
    if found is None:
        raise NotFound("chapter not found")
    chapter, doc = found

    def event(payload: dict[str, Any]) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    async def generate() -> AsyncIterator[str]:
        pieces: list[str] = []
        try:
            for token in stream_summary(llm_router, level, chapter, doc.chunks):
                pieces.append(token)
                yield event({"token": token})
        except Exception as exc:  # noqa: BLE001 - the stream must close cleanly
            logger.exception("summary stream failed for chapter %s", chapter_id)
            yield event({"error": type(exc).__name__})
            return
        row = documents.upsert_summary(
            chapter_id=chapter.id,
            user_id=chapter.user_id,
            level=level,
            content="".join(pieces),
            model=settings.llm_logfare_model,
        )
        yield event({"done": True, "summary_id": row["id"]})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/chapters/{chapter_id}/summary")
async def get_chapter_summary(
    chapter_id: str,
    level: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, Any]:
    """Saved summary for a level, so reload never re-calls the LLM (task 2.5)."""
    if level not in LEVELS:
        raise InvalidInput("level must be one of: standard, eli5, deep_dive")
    found = documents.get_chapter_for_user(chapter_id, user_id)
    if found is None:
        raise NotFound("chapter not found")
    row = documents.get_summary(chapter_id, level, user_id)
    if row is None:
        raise NotFound("summary not generated yet")
    return row


@app.get("/api/documents/{document_id}/chapters")
async def list_chapters(document_id: str, user_id: Annotated[str, Depends(current_user_id)]) -> list[dict[str, Any]]:
    doc = documents.get_for_user(document_id, user_id)
    if doc is None:
        raise NotFound("document not found")
    return [
        {"id": c.id, "title": c.title, "ordinal": c.ordinal, "start_page": c.start_page, "end_page": c.end_page}
        for c in doc.chapters
    ]


@app.post("/api/documents/{document_id}/flashcards", status_code=202)
async def enqueue_flashcards(document_id: str, user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, str]:
    doc = documents.get_for_user(document_id, user_id)
    if doc is None:
        raise NotFound("document not found")
    job_id = enqueue("generate_flashcards", {"user_id": user_id, "document_id": doc.id})
    return {"job_id": job_id}


@app.get("/api/documents/{document_id}/flashcards")
async def list_flashcards(document_id: str, user_id: Annotated[str, Depends(current_user_id)]) -> list[dict[str, Any]]:
    doc = documents.get_for_user(document_id, user_id)
    if doc is None:
        raise NotFound("document not found")
    return documents.list_flashcards(document_id, user_id)


@app.get("/api/flashcards/review-queue")
async def review_queue(user_id: Annotated[str, Depends(current_user_id)]) -> list[dict[str, Any]]:
    """SM-2 due queue for today (task 2.12)."""
    today = datetime.now(UTC).date().isoformat()
    return documents.due_flashcards(user_id, today)


@app.post("/api/flashcards/{card_id}/review")
async def review_flashcard(
    card_id: str, body: dict[str, Any], user_id: Annotated[str, Depends(current_user_id)]
) -> dict[str, Any]:
    """Server-authoritative SM-2 update (task 2.12)."""
    try:
        grade = int((body or {}).get("grade", ""))
    except (TypeError, ValueError):
        raise InvalidInput("grade must be an integer 0..5") from None
    if not 0 <= grade <= 5:
        raise InvalidInput("grade must be an integer 0..5")

    card = documents.get_flashcard_for_user(card_id, user_id)
    if card is None:
        raise NotFound("flashcard not found")

    from app.ai.sm2 import Sm2State, review
    from app.ai.sm2 import due_date as _due

    prev = Sm2State(
        ease_factor=float(card["ease_factor"]),
        interval_days=int(card["interval_days"]),
        repetitions=int(card["repetitions"]),
    )

    # Record the review FIRST. `review_id` is the offline queue's idempotency key
    # (task 3.4): if it was already stored, this is a replay and SM-2 must not
    # advance a second time.
    review_id = (body or {}).get("review_id")
    recorded = documents.add_review(
        card_id=card_id,
        user_id=user_id,
        grade=grade,
        client_review_id=str(review_id) if review_id else None,
    )
    if not recorded:
        return {
            "id": card_id,
            "ease_factor": prev.ease_factor,
            "interval_days": prev.interval_days,
            "repetitions": prev.repetitions,
            "due_date": card["due_date"],
            "replayed": True,
        }

    nxt = review(prev, grade)
    due = _due(datetime.now(UTC).date(), nxt.interval_days)
    documents.update_flashcard_sm2(
        card_id, ease=nxt.ease_factor, interval_days=nxt.interval_days, reps=nxt.repetitions, due=due
    )
    return {
        "id": card_id,
        "ease_factor": nxt.ease_factor,
        "interval_days": nxt.interval_days,
        "repetitions": nxt.repetitions,
        "due_date": due,
    }


@app.post("/api/documents/{document_id}/chat")
async def chat(
    document_id: str,
    body: dict[str, Any],
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, Any]:
    """Grounded chat with citations (task 2.10)."""
    from app.rag.chat import ChatAnswer

    question = (body.get("question") or "").strip() if isinstance(body, dict) else ""
    if not question:
        raise InvalidInput("question is required")
    doc = documents.get_for_user(document_id, user_id)
    if doc is None:
        raise NotFound("document not found")
    if not isinstance(documents, PgDocumentStore):
        raise InvalidInput("chat requires the Postgres document store")

    result: ChatAnswer = await asyncio.to_thread(
        answer_question,
        doc=doc,
        question=question[:4000],
        store=documents,
        embedder=embedder,
        router=llm_router,
    )
    return {
        "answer": result.answer,
        "citations": [
            {"chunk_id": c.chunk_id, "page": c.page, "quote": c.quote} for c in result.citations
        ],
    }


# --- Focus sessions, tokens, dashboard and readiness (phase 3) --------------


@app.post("/api/focus-sessions", status_code=201)
async def start_focus_session(
    body: dict[str, Any], user_id: Annotated[str, Depends(current_user_id)]
) -> dict[str, Any]:
    """Start a focus timer. The server sets the timestamps so the client cannot
    inflate a session (task 3.1)."""
    kind = str((body or {}).get("kind", "")).strip()
    if kind not in FOCUS_KINDS:
        raise InvalidInput("kind must be one of: pomodoro, desk, ultradian")
    planned = FOCUS_KINDS[kind]
    requested = (body or {}).get("planned_seconds")
    if isinstance(requested, int) and 60 <= requested <= 4 * 60 * 60:
        planned = requested
    if study.running_session(user_id) is not None:
        raise InvalidInput("a focus session is already running")
    return study.start_session(user_id, kind, planned)


@app.get("/api/focus-sessions/current")
async def current_focus_session(user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, Any] | None:
    """Survives refresh/navigation: the client renders from these timestamps."""
    return study.running_session(user_id)


@app.post("/api/focus-sessions/{session_id}/complete")
async def complete_focus_session(
    session_id: str, user_id: Annotated[str, Depends(current_user_id)]
) -> dict[str, Any]:
    """Server-verified completion and reward (tasks 3.2, 3.3).

    Replaying this call does not pay twice: the ledger's unique
    (reason, ref_id) swallows the second insert.
    """
    row = study.get_session(session_id, user_id)
    if row is None:
        raise NotFound("focus session not found")
    if row["status"] != "running":
        return {
            **row,
            "tokens_awarded": 0,
            "token_balance": study.balance(user_id),
            "replayed": True,
        }

    started = datetime.fromisoformat(row["started_at"])
    expected_end = datetime.fromisoformat(row["expected_end_at"])
    now = datetime.now(UTC)
    status, actual, tokens = settle(
        planned_seconds=int(row["planned_seconds"]), started_at=started, now=now, expected_end_at=expected_end
    )
    study.close_session(session_id, status=status, actual_seconds=actual, tokens=tokens, now=now)
    return {
        "id": session_id,
        "status": status,
        "actual_seconds": actual,
        "tokens_awarded": tokens,
        "token_balance": study.balance(user_id),
        "replayed": False,
    }


@app.get("/api/tokens/balance")
async def token_balance(user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, int]:
    return {"balance": study.balance(user_id)}


@app.get("/api/dashboard")
async def dashboard(user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, Any]:
    """Aggregates for the charts (task 3.7)."""
    return study.dashboard(user_id)


@app.get("/api/readiness")
async def readiness(user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, Any]:
    """Readiness score with its components (task 3.6)."""
    raw = study.readiness_inputs(user_id)
    return breakdown(ReadinessInputs(**raw))


@app.get("/api/privacy/export")
async def export_personal_data(user_id: Annotated[str, Depends(current_user_id)]) -> JSONResponse:
    """Download all app data that belongs to the signed-in user as JSON."""
    if not isinstance(documents, PgDocumentStore):
        raise NotFound("data export is unavailable in the in-memory development store")
    store = PrivacyStore(settings.database_url)
    try:
        data = store.export_user_data(user_id)
    finally:
        store.close()
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": 'attachment; filename="studyvault-data-export.json"'},
    )


# --- Exam planner and weekly advice (tasks 3.5, 3.8) ------------------------


@app.post("/api/documents/{document_id}/study-plan")
async def create_study_plan(
    document_id: str, body: dict[str, Any], user_id: Annotated[str, Depends(current_user_id)]
) -> dict[str, Any]:
    """Day-by-day plan for an exam date (task 3.5). Falls back to an even split
    when the LLM misbehaves; the plan is always schema-validated JSON."""
    from datetime import date as _date

    from app.ai.advice import plan_for_document

    exam_raw = str((body or {}).get("exam_date", "")).strip()
    try:
        exam_date = _date.fromisoformat(exam_raw)
    except ValueError:
        raise InvalidInput("exam_date must be YYYY-MM-DD") from None
    minutes = (body or {}).get("minutes_per_day", 60)
    if not isinstance(minutes, int) or not 15 <= minutes <= 480:
        minutes = 60

    doc = documents.get_for_user(document_id, user_id)
    if doc is None:
        raise NotFound("document not found")
    if not doc.chapters:
        raise InvalidInput("document has no chapters yet — wait for structuring to finish")

    plan = plan_for_document(
        router=llm_router, chapters=doc.chapters, exam_date=exam_date, today=datetime.now(UTC).date(),
        minutes_per_day=minutes,
    )
    if hasattr(documents, "save_study_plan"):
        documents.save_study_plan(
            user_id=user_id, document_id=doc.id, exam_date=exam_raw, plan=plan.model_dump(mode="json")
        )
    return plan.model_dump(mode="json")


@app.get("/api/documents/{document_id}/study-plan")
async def get_study_plan(document_id: str, user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, Any]:
    doc = documents.get_for_user(document_id, user_id)
    if doc is None:
        raise NotFound("document not found")
    if not hasattr(documents, "get_study_plan"):
        raise NotFound("no saved plan")
    saved = documents.get_study_plan(document_id, user_id)
    if saved is None:
        raise NotFound("no saved plan")
    return saved


@app.get("/api/advice/weekly")
async def weekly_advice(user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, Any]:
    """'Next Week Advice' from last-7-day metrics (task 3.8). Cached per user;
    regenerating replaces the row. Quota counts as an AI call."""
    from app.ai.advice import advice_for_metrics

    metrics = study.dashboard(user_id)
    saved = study.get_weekly_advice(user_id) if hasattr(study, "get_weekly_advice") else None
    if saved is not None:
        return {**saved, "cached": True}
    text = advice_for_metrics(llm_router, metrics)
    row = study.save_weekly_advice(user_id, text, model=settings.llm_logfare_model)
    return {**row, "cached": False}


# --- Phase 4: TTS, Viva, mind map, code review, citations ------------------


@app.post("/api/tts")
async def text_to_speech(
    body: dict[str, Any], user_id: Annotated[str, Depends(current_user_id)]
) -> dict[str, Any]:
    """Text -> audio + word-boundary timings for karaoke (tasks 4.1-4.3).

    Server-side edge-tts when available; the UI falls back to SpeechSynthesis
    on a 503, so an empty answer is a contract, not a crash.
    """
    text = str((body or {}).get("text", "")).strip()
    if not text:
        raise InvalidInput("text is required")
    from base64 import b64encode

    from app.voice.tts import TtsUnavailable, synthesize

    try:
        clip = await synthesize(text[:8000], voice=(body or {}).get("voice") or None)
    except TtsUnavailable as exc:
        raise InvalidInput("server-side TTS unavailable; use browser speech") from exc
    return {
        "audio_b64": b64encode(clip.audio).decode("ascii"),
        "content_type": clip.content_type,
        "words": clip.words_json(),
    }


@app.post("/api/tts/stream")
async def text_to_speech_stream(
    body: dict[str, Any], user_id: Annotated[str, Depends(current_user_id)]
) -> StreamingResponse:
    """Progressively deliver MP3 chunks and word timing events over SSE."""
    text = str((body or {}).get("text", "")).strip()
    if not text:
        raise InvalidInput("text is required")
    from app.voice.tts import TtsUnavailable, edge_available, stream_events

    if not edge_available():
        raise InvalidInput("server-side TTS unavailable; use browser speech")

    async def events():
        try:
            async for event in stream_events(text[:8000], voice=(body or {}).get("voice") or None):
                yield event
        except TtsUnavailable:
            logger.exception("tts_stream_failed", extra={"user_id": user_id})
            yield 'event: error\ndata: {"message":"speech synthesis failed"}\n\n'

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/documents/{document_id}/viva-questions")
async def viva_questions(document_id: str, user_id: Annotated[str, Depends(current_user_id)]) -> list[dict[str, Any]]:
    from app.voice.viva import ask, to_dict

    doc = documents.get_for_user(document_id, user_id)
    if doc is None:
        raise NotFound("document not found")
    question_set = await asyncio.to_thread(ask, llm_router, doc.chunks)
    return [to_dict(q) for q in question_set.questions]


@app.post("/api/viva-grade")
async def viva_grade(body: dict[str, Any], user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, Any]:
    from app.voice.viva import grade

    question = str((body or {}).get("question", "")).strip()
    answer = str((body or {}).get("answer", "")).strip()
    expected = (body or {}).get("expected_points") or []
    if not question or not answer:
        raise InvalidInput("question and answer are required")
    result = await asyncio.to_thread(grade, llm_router, question=question, expected=expected, answer=answer)
    return result.model_dump()


@app.get("/api/documents/{document_id}/mindmap")
async def mindmap(document_id: str, user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, Any]:
    from app.ai.mindmap import as_json, build

    doc = documents.get_for_user(document_id, user_id)
    if doc is None:
        raise NotFound("document not found")
    mm = await asyncio.to_thread(build, llm_router, doc.chapters, doc.chunks)
    return as_json(mm)


@app.post("/api/code-review")
async def code_review(body: dict[str, Any], user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, Any]:
    from app.ai.code_review import MAX_CODE_CHARS, as_json, review_code

    code = str((body or {}).get("code", ""))
    language = str((body or {}).get("language", "unknown")).strip() or "unknown"
    if not code.strip():
        raise InvalidInput("code is required")
    review = await asyncio.to_thread(review_code, llm_router, code=code[:MAX_CODE_CHARS], language=language)
    return as_json(review)


@app.post("/api/citations")
async def citation(body: dict[str, Any], user_id: Annotated[str, Depends(current_user_id)]) -> dict[str, Any]:
    from app.ai.citations import SourceMeta, format_citation

    style = str((body or {}).get("style", "")).strip()
    meta = SourceMeta(
        authors=list((body or {}).get("authors", [])),
        title=str((body or {}).get("title", "")),
        year=str((body or {}).get("year", "")),
        container=str((body or {}).get("container", "")),
        url=str((body or {}).get("url", "")),
        pages=str((body or {}).get("pages", "")),
    )
    try:
        text = format_citation(meta, style)
    except ValueError as exc:
        raise InvalidInput(str(exc)) from exc
    return {"citation": text, "style": style}
