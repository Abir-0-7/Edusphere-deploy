"""Loopback-only F04 browser acceptance with real worker/router and fake HTTP LLM."""

import json
import threading
from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, Header
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.course_generation.router import course_generation_router
from app.course_generation.service import JOB_KIND, GenerationService
from app.course_generation.store import MemoryGenerationStore
from app.course_outlines.contracts import OutlineApproveRequest, OutlineCreateRequest
from app.course_outlines.store import MemoryOutlineStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, Unauthorized, api_error_handler, error_body
from app.jobs.worker import InMemoryJobStore, Worker
from app.llm.admission import AdmissionGuard, MemoryDailyQuota, MemoryMinuteLimiter, current_ai_owner
from app.llm.budgets import BudgetLimits, MemoryBudgetStore
from app.llm.operations import MemoryOperations
from app.llm.router import LLMRouter, Provider
from app.llm.usage_ledger import MemoryUsageLedger
from app.source_versions.store import MemorySourceVersionStore
from tests.course_outline_fixture import draft_plan, reviewed_plan, seed_sources

documents = InMemoryDocumentStore()
sources = MemorySourceVersionStore(documents)
outlines = MemoryOutlineStore(sources)
jobs = InMemoryJobStore()
store = MemoryGenerationStore(outlines, jobs)
_lock = threading.RLock()
_owners, _modes, _calls, _waiting = {}, {}, {}, {}


def provider(request):
    owner = current_ai_owner()
    payload = json.loads(json.loads(request.content)["messages"][1]["content"])["untrusted_lesson_data"]
    objective = payload["objective"]["id"]
    with _lock:
        _calls.setdefault(owner, []).append(objective)
        mode = _modes.get(owner, "normal")
        if objective == "momentum" and mode == "outage_once":
            _modes[owner] = "normal"
            return httpx.Response(503, json={"error": "fixture provider unavailable"})
        hold = objective == "momentum" and mode == "hold"
        if hold:
            _waiting.setdefault(owner, threading.Event())
            event = _waiting[owner]
    if hold:
        event.wait(20)
    return httpx.Response(200, json={
        "choices": [{"message": {"content": json.dumps({
            "title": payload["objective"]["title"],
            "explanation": "Consider the system boundary before applying a conservation law.",
            "worked_example": "Identify an isolated system and describe the energy transfers within it.",
            "question": "Which assumption must be checked first?",
            "answer": "Check whether the chosen system is isolated from the relevant external influence.",
            "evidence_ids": ["pin-1"],
        })}}], "usage": {"prompt_tokens": 200, "completion_tokens": 150},
    })


router = LLMRouter(
    providers=[Provider("fixture", "https://fixture.invalid/v1", "fixture-model", None)],
    max_retries=0, max_provider_attempts=1, timeout_seconds=25,
    client_factory=lambda **kwargs: httpx.Client(transport=httpx.MockTransport(provider), **kwargs),
    admission=AdmissionGuard(MemoryDailyQuota(), MemoryMinuteLimiter(100), 100),
    operations=MemoryOperations(), budget_store=MemoryBudgetStore(),
    budget_limits=BudgetLimits(10000000, 100000000, 100000000, 3, 10, 60),
    usage_ledger=MemoryUsageLedger(),
)
service = GenerationService(store, outlines, jobs, router)
worker = Worker(jobs, {JOB_KIND: service.handle}, backoff_seconds=0.1)


@asynccontextmanager
async def lifespan(_app):
    stopped = threading.Event()

    def process():
        while not stopped.is_set():
            if not worker.process_one():
                stopped.wait(0.05)

    thread = threading.Thread(target=process, daemon=True)
    thread.start()
    yield
    stopped.set()
    for event in _waiting.values():
        event.set()
    thread.join(timeout=2)


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:4335"], allow_methods=["*"], allow_headers=["*"])
app.add_exception_handler(ApiError, api_error_handler)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _exc):
    return JSONResponse(status_code=400, content=error_body("Invalid generation request", "invalid_input"))


async def owner(authorization: str | None = Header(None)):
    if not authorization or not authorization.startswith("Bearer generation-fixture-"):
        raise Unauthorized()
    identifier = authorization.removeprefix("Bearer ")
    with _lock:
        if identifier not in _owners:
            book, repo = seed_sources(documents, sources, identifier)
            record = outlines.create(identifier, OutlineCreateRequest(
                id=uuid4(), plan=reviewed_plan(draft_plan(book, repo)),
            ))
            record = outlines.approve(identifier, str(record.id), OutlineApproveRequest(
                expected_revision=record.revision, content_hash=record.content_hash, reviewed_evidence=True,
            ))
            _owners[identifier] = str(record.id)
    return identifier


app.include_router(course_generation_router(owner, service, enabled=True))
User = Depends(owner)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/fixture/approved-outline")
def approved_outline(user_id=User):
    return outlines.get(user_id, _owners[user_id])


class ProviderMode(BaseModel):
    mode: str


@app.post("/api/fixture/provider-mode")
def set_mode(body: ProviderMode, user_id=User):
    if body.mode not in {"normal", "outage_once", "hold", "release"}:
        return JSONResponse(status_code=400, content={"error": "unknown fixture mode"})
    with _lock:
        if body.mode == "release":
            _waiting.setdefault(user_id, threading.Event()).set()
            _modes[user_id] = "normal"
        else:
            _modes[user_id] = body.mode
            _waiting[user_id] = threading.Event()
    return {"status": "ok"}


@app.get("/api/fixture/provider-state")
def provider_state(user_id=User):
    with _lock:
        return {"calls": list(_calls.get(user_id, []))}
