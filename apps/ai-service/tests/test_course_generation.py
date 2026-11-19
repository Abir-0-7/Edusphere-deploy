"""F04 real worker/router acceptance with deterministic, network-free providers."""

import json
from datetime import UTC, datetime, timedelta
from threading import Event, Thread
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.course_generation.contracts import (
    GenerationActionRequest,
    GenerationApprovalRef,
    GenerationResumeRequest,
    GenerationStartRequest,
)
from app.course_generation.router import course_generation_router
from app.course_generation.service import JOB_KIND, GenerationService, messages_for
from app.course_generation.store import MemoryGenerationStore
from app.course_outlines.contracts import OutlineApproveRequest, OutlineCreateRequest, OutlineUpdateRequest
from app.course_outlines.store import MemoryOutlineStore
from app.courses.catalog import python_foundations
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, Conflict, InvalidInput, NotFound, api_error_handler
from app.jobs.worker import InMemoryJobStore, Worker
from app.llm.admission import AdmissionGuard, MemoryDailyQuota, MemoryMinuteLimiter
from app.llm.budgets import BudgetLimits, MemoryBudgetStore
from app.llm.cache_scope import PrivateResponseCache, ResponseScope, scope_payload
from app.llm.operations import MemoryOperations
from app.llm.response_cache import MemoryResponseCache
from app.llm.router import LLMRouter, Provider
from app.source_versions.store import MemorySourceVersionStore
from tests.course_outline_fixture import draft_plan, reviewed_plan, seed_sources


def lesson(title="Energy conservation", **changes):
    return {"title": title, "explanation": "An isolated system conserves energy.",
            "worked_example": "Track transfers across a chosen boundary.",
            "question": "When is total energy conserved?", "answer": "For an isolated system.",
            "evidence_ids": ["pin-1"], **changes}


class Harness:
    def __init__(self, callback=None, *, provider_attempts=1, max_retries=0, **limits):
        self.documents = InMemoryDocumentStore()
        self.sources = MemorySourceVersionStore(self.documents)
        self.book, self.repo = seed_sources(self.documents, self.sources, "owner")
        self.outlines = MemoryOutlineStore(self.sources)
        plan = reviewed_plan(draft_plan(self.book, self.repo))
        outline = self.outlines.create("owner", OutlineCreateRequest(id=uuid4(), plan=plan))
        self.outline = self.outlines.approve("owner", str(outline.id), OutlineApproveRequest(
            expected_revision=outline.revision, content_hash=outline.content_hash, reviewed_evidence=True))
        self.reference = GenerationApprovalRef(outline_id=self.outline.id, approval_id=self.outline.approval.id,
                                               outline_revision=self.outline.revision,
                                               outline_content_hash=self.outline.content_hash)
        self.jobs = InMemoryJobStore(lease_seconds=60)
        self.store = MemoryGenerationStore(self.outlines, self.jobs)
        self.calls = []
        self.callback = callback

        def transport(request):
            data = json.loads(request.content)
            self.calls.append(data)
            result = self.callback(self, data) if self.callback else lesson()
            if isinstance(result, httpx.Response):
                return result
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(result)}}],
                                            "usage": {"prompt_tokens": 50, "completion_tokens": 70}})

        self.budgets, self.quota = MemoryBudgetStore(), MemoryDailyQuota()
        self.operations = MemoryOperations(lease_seconds=1)
        self.cache = MemoryResponseCache(max_content_chars=32000, max_entries_per_user=100)
        router = LLMRouter(
            providers=[Provider("fixture", "https://provider.invalid/v1", "fixture-model", None)],
            max_provider_attempts=provider_attempts, max_retries=max_retries, max_output_tokens=1024,
            circuit_failure_threshold=100, operations=self.operations,
            admission=AdmissionGuard(self.quota, MemoryMinuteLimiter(1000), 1000),
            budget_store=self.budgets,
            budget_limits=BudgetLimits(10000000, 10000000, 10000000, 10, 10, 300),
            cache=PrivateResponseCache(self.cache, 3600),
            client_factory=lambda **kwargs: httpx.Client(transport=httpx.MockTransport(transport), **kwargs),
        )
        self.service = GenerationService(self.store, self.outlines, self.jobs, router, **limits)
        self.worker = Worker(self.jobs, {JOB_KIND: self.service.handle}, backoff_seconds=0)

    def start(self):
        preview = self.service.preview("owner", self.reference)
        self.body = GenerationStartRequest(**self.reference.model_dump(), id=uuid4(),
                                           preview_hash=preview.preview_hash, accept_budget=True)
        return self.service.start("owner", self.body)

    def get(self):
        return self.service.get("owner", str(self.body.id))

    def resume(self):
        run = self.get()
        return self.service.resume("owner", str(run.id), GenerationResumeRequest(
            expected_revision=run.revision, accept_remaining_budget=True))


def test_two_source_bounded_stages_are_private_and_never_change_published_release():
    harness = Harness()
    published = python_foundations().model_dump_json()
    run = harness.start()
    assert run.maximum_tokens == sum(stage.token_upper_bound for stage in run.stages) * 2
    assert harness.service.start("owner", harness.body).id == run.id and len(harness.jobs.jobs) == 1
    assert harness.worker.process_one()
    result = harness.get()
    assert result.status == "done" and [stage.attempts for stage in result.stages] == [1, 1]
    assert result.visibility == "private" and result.editorial_status == "not_reviewed"
    assert all(stage.output.evidence_ids == ["pin-1"] for stage in result.stages)
    assert len(harness.calls) == 2 and len(harness.operations.rows) == 2
    for stage, call in zip(result.stages, harness.calls, strict=True):
        data = json.loads(call["messages"][1]["content"])["untrusted_lesson_data"]
        assert data["objective"]["id"] == stage.id
        assert all(set(pin) == {"id", "quote"} for pin in data["evidence"])
        assert "segments" not in str(data) and "UNTRUSTED" in call["messages"][0]["content"]
        assert call["max_tokens"] == result.policy.max_output_tokens
    assert all(row.state == "settled" and row.actual_tokens == 120 for row in harness.budgets.rows.values())
    assert result.allocated_tokens == sum(stage.token_upper_bound for stage in result.stages)
    assert python_foundations().model_dump_json() == published


def test_provider_outage_retains_completed_stage_and_explicit_resume_keeps_prior_budget():
    def outage(harness, data):
        return httpx.Response(503) if len(harness.calls) == 2 else lesson()

    harness = Harness(outage)
    harness.start()
    assert harness.worker.process_one()
    failed = harness.get()
    assert failed.status == "failed" and failed.stages[0].status == "done"
    assert failed.stages[1].status == "needs_retry" and failed.stages[1].error_code == "provider_unavailable"
    old_output, old_allocation = failed.stages[0].output, failed.allocated_tokens
    assert len(harness.calls) == 2
    # The failed call stays conservatively charged; resume does not refund it.
    failed_budget = list(harness.budgets.rows.values())[-1]
    assert failed_budget.actual_tokens == failed_budget.reserved_tokens
    harness.callback = None
    resumed = harness.resume()
    assert resumed.allocated_tokens == old_allocation and resumed.job_id != failed.job_id
    assert harness.worker.process_one()
    result = harness.get()
    assert result.status == "done" and result.stages[0].output == old_output
    assert [stage.attempts for stage in result.stages] == [1, 2] and len(harness.calls) == 3
    assert result.allocated_tokens == old_allocation + result.stages[1].token_upper_bound
    assert len(harness.budgets.rows) == 3


def test_invalid_or_forged_evidence_fails_closed_and_exhausts_fixed_attempt_cap():
    harness = Harness(lambda *_: lesson(evidence_ids=["pin-4"]))
    harness.start()
    assert harness.worker.process_one()
    assert harness.get().stages[0].error_code == "invalid_output"
    assert len(harness.cache._entries) == 0
    harness.resume()
    harness.worker.process_one()
    assert harness.get().stages[0].attempts == 2
    with pytest.raises(Conflict, match="exhausted"):
        harness.resume()
    assert len(harness.calls) == 2


def test_worker_death_after_raw_success_reuses_operation_before_checkpoint(monkeypatch):
    harness = Harness()
    run = harness.start()
    save = harness.store.save

    def fail_before_checkpoint(user, candidate, revision, **kwargs):
        if candidate.stages[0].status == "done":
            raise SystemExit("simulated worker death after remote success")
        return save(user, candidate, revision, **kwargs)

    monkeypatch.setattr(harness.store, "save", fail_before_checkpoint)
    with pytest.raises(SystemExit):
        harness.worker.process_one()
    assert len(harness.calls) == 1 and harness.store.get("owner", str(run.id)).stages[0].status == "running"
    monkeypatch.setattr(harness.store, "save", save)
    recovered = Worker(harness.jobs, {JOB_KIND: harness.service.handle})
    assert recovered.process_one(now=datetime.now(UTC) + timedelta(seconds=61))
    assert harness.get().status == "done" and len(harness.calls) == 2
    assert [stage.attempts for stage in harness.get().stages] == [1, 1]
    assert len(harness.budgets.rows) == 2


def test_worker_death_after_checkpoint_skips_completed_output(monkeypatch):
    harness = Harness()
    run = harness.start()
    save = harness.store.save

    def die_after_checkpoint(user, candidate, revision, **kwargs):
        saved = save(user, candidate, revision, **kwargs)
        if candidate.stages[0].status == "done":
            raise SystemExit("simulated worker death after checkpoint")
        return saved

    monkeypatch.setattr(harness.store, "save", die_after_checkpoint)
    with pytest.raises(SystemExit):
        harness.worker.process_one()
    kept = harness.store.get("owner", str(run.id)).stages[0].output
    monkeypatch.setattr(harness.store, "save", save)
    assert harness.worker.process_one(now=datetime.now(UTC) + timedelta(seconds=61))
    assert harness.get().status == "done" and len(harness.calls) == 2
    assert harness.get().stages[0].output == kept


def test_cancel_during_provider_stops_late_write_and_resume_recovers_known_success():
    entered, release = Event(), Event()

    def delayed(*_):
        entered.set()
        assert release.wait(10)
        return lesson()

    harness = Harness(delayed)
    run = harness.start()
    thread = Thread(target=harness.worker.process_one)
    thread.start()
    assert entered.wait(5)
    current = harness.get()
    cancelled = harness.service.cancel("owner", str(run.id), GenerationActionRequest(
        expected_revision=current.revision))
    release.set()
    thread.join(5)
    assert not thread.is_alive()
    assert cancelled.status == "cancelled" and harness.get().stages[0].output is None
    before = harness.get().allocated_tokens
    harness.callback = None
    harness.resume()
    assert harness.worker.process_one()
    assert harness.get().status == "done" and len(harness.calls) == 2
    assert harness.get().allocated_tokens == before + harness.get().stages[1].token_upper_bound


def test_cancel_between_provider_retries_never_starts_a_fallback_or_new_attempt():
    def cancel_after_failure(harness, _):
        current = harness.get()
        harness.service.cancel("owner", str(current.id), GenerationActionRequest(expected_revision=current.revision))
        return httpx.Response(503)

    harness = Harness(cancel_after_failure, provider_attempts=3, max_retries=2)
    harness.service.router.sleep = lambda _: None
    harness.start()
    assert harness.worker.process_one()
    assert harness.get().status == "cancelled" and len(harness.calls) == 1


def test_uncertain_operation_never_automatically_calls_provider_again(monkeypatch):
    harness = Harness()
    harness.start()
    save = harness.store.save

    def before_call(user, candidate, revision, **kwargs):
        saved = save(user, candidate, revision, **kwargs)
        if candidate.stages[0].status == "running" and candidate.stages[0].attempts == 1:
            # Simulate a provider result lost after request transmission: operation
            # is present and uncertain, with its conservative reservation retained.
            from app.llm.admission import ai_scope
            from app.llm.cache_scope import response_scope
            from app.llm.operations import operation_scope
            with ai_scope(user), response_scope("course_generation", variant=candidate.preview_hash,
                                               generation_run_id=str(candidate.id)), operation_scope(
                f"course-generation:{candidate.id}:{candidate.stages[0].id}:1"
            ):
                original = harness.service.router.client_factory
                harness.service.router.client_factory = lambda **kw: httpx.Client(
                    transport=httpx.MockTransport(lambda _: httpx.Response(503)), **kw)
                with pytest.raises(Exception, match="failed after retries"):
                    harness.service.router.complete(messages_for(candidate.plan, candidate.plan.objectives[0]))
                harness.service.router.client_factory = original
        return saved

    monkeypatch.setattr(harness.store, "save", before_call)
    harness.worker.process_one()
    result = harness.get()
    assert result.status == "failed" and result.stages[0].error_code == "operation_uncertain"
    assert len(harness.calls) == 0 and len(harness.budgets.rows) == 1
    monkeypatch.setattr(harness.store, "save", save)
    harness.resume()
    harness.worker.process_one()
    assert harness.get().status == "done" and len(harness.budgets.rows) == 3


def test_quota_waits_reuse_allocated_attempt_and_budget_without_provider_calls():
    harness = Harness()
    harness.service.router.admission = AdmissionGuard(harness.quota, MemoryMinuteLimiter(1000), 1)
    harness.start()
    harness.worker.process_one()
    current = harness.get()
    assert current.stages[0].status == "done" and current.stages[1].status == "running"
    allocation = current.allocated_tokens
    assert len(harness.calls) == 1
    job = harness.jobs.get(str(current.job_id), "owner")
    assert job.status == "pending"
    harness.worker.process_one(now=job.run_after)
    assert harness.get().allocated_tokens == allocation and len(harness.calls) == 1


def test_stale_preview_scope_policy_and_owners_rejected_without_enqueuing_or_debit():
    harness = Harness()
    preview = harness.service.preview("owner", harness.reference)
    body = GenerationStartRequest(**harness.reference.model_dump(), id=uuid4(),
                                  preview_hash="0" * 64, accept_budget=True)
    with pytest.raises(Conflict, match="estimate changed"):
        harness.service.start("owner", body)
    with pytest.raises(NotFound):
        harness.service.preview("other", harness.reference)
    assert len(harness.jobs.jobs) == len(harness.budgets.rows) == 0
    run = harness.start()
    harness.outlines.update("owner", str(harness.outline.id), OutlineUpdateRequest(
        expected_revision=harness.outline.revision, plan=harness.outline.plan.model_copy(update={"title": "Edited"})))
    assert harness.service.start("owner", harness.body).id == run.id
    assert harness.worker.process_one()  # existing immutable approval remains usable
    assert harness.get().status == "done" and harness.get().plan.title == preview.title
    with pytest.raises(NotFound):
        harness.service.get("other", str(run.id))


def test_preview_rejects_oversized_stage_or_total_budget_without_truncation():
    harness = Harness(max_input_bytes=1024)
    with pytest.raises(InvalidInput, match="prompt byte limit"):
        harness.service.preview("owner", harness.reference)
    harness = Harness(max_run_tokens=1)
    with pytest.raises(InvalidInput, match="generation budget"):
        harness.service.preview("owner", harness.reference)
    assert len(harness.jobs.jobs) == len(harness.calls) == 0


def test_source_deletion_revokes_run_and_prevents_late_checkpoint_or_resurrection():
    harness = Harness()
    run = harness.start()
    harness.sources._rows.pop(("owner", str(harness.repo.id)))
    with pytest.raises(NotFound):
        harness.get()
    assert harness.store.list("owner").total_count == 0
    with pytest.raises(NotFound):
        harness.store.get("owner", str(run.id))
    assert not harness.jobs.jobs


def test_api_owner_routes_default_disabled_and_shared_error_shapes():
    harness = Harness()
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(course_generation_router(lambda: "owner", harness.service, enabled=True))
    client = TestClient(app)
    response = client.post("/api/course-generations/preview", json=harness.reference.model_dump(mode="json"))
    assert response.status_code == 200
    run = harness.start()
    assert client.get(f"/api/course-generations/{run.id}").json()["visibility"] == "private"
    assert client.get("/api/course-generations?limit=1").json()["total_count"] == 1
    assert client.post(f"/api/course-generations/{run.id}/cancel",
                       json={"expected_revision": 100}).status_code == 409
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(course_generation_router(lambda: "owner", harness.service))
    disabled = TestClient(app)
    response = disabled.post("/api/course-generations/preview", json=harness.reference.model_dump(mode="json"))
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"


def test_legacy_operation_and_cache_scope_keys_are_unchanged():
    scope = ResponseScope("summary", None, None, "1", "default", "source")
    assert scope_payload(scope) == {"namespace": "summary", "document_id": None, "source_revision": None,
                                     "schema_version": "1", "variant": "default", "language": "source"}


def test_crash_after_final_checkpoint_finalizes_without_regeneration(monkeypatch):
    harness = Harness()
    harness.start()
    save = harness.store.save

    def die_before_done(user, candidate, revision, **kwargs):
        if candidate.status == "done":
            raise SystemExit("worker died before final run completion")
        return save(user, candidate, revision, **kwargs)

    monkeypatch.setattr(harness.store, "save", die_before_done)
    with pytest.raises(SystemExit):
        harness.worker.process_one()
    run = harness.get()
    assert all(stage.status == "done" for stage in run.stages) and run.status == "running"
    allocated = run.allocated_tokens
    # An owner may cancel a stalled job then resume solely to finalize its saved
    # checkpoints. Neither action recreates lessons nor expands the allocation.
    harness.service.cancel("owner", str(run.id), GenerationActionRequest(expected_revision=run.revision))
    monkeypatch.setattr(harness.store, "save", save)
    harness.resume()
    harness.worker.process_one()
    assert harness.get().status == "done" and harness.get().allocated_tokens == allocated
    assert len(harness.calls) == 2


def test_resume_rejects_changed_generation_policy_without_resetting_work():
    harness = Harness(lambda *_: httpx.Response(503))
    harness.start()
    harness.worker.process_one()
    before = harness.get()
    harness.service.policy = harness.service.policy.model_copy(update={"provider_fingerprint": "f" * 64})
    with pytest.raises(Conflict, match="policy changed"):
        harness.resume()
    assert harness.get() == before and len(harness.calls) == 1


def test_generation_settings_are_default_off_and_bound_storage_prompts_and_retries():
    from pydantic import ValidationError

    from app.settings import Settings

    settings = Settings(_env_file=None)
    assert settings.course_generation_enabled is False
    assert settings.course_generation_max_stage_attempts == 2
    for key, value in (("AI_SERVICE_COURSE_GENERATION_MAX_STAGE_ATTEMPTS", 0),
                       ("AI_SERVICE_COURSE_GENERATION_MAX_INPUT_BYTES", 64001),
                       ("AI_SERVICE_COURSE_GENERATION_MAX_OUTPUT_TOKENS", 4097),
                       ("AI_SERVICE_COURSE_GENERATION_STORAGE_TIMEOUT_SECONDS", 11),
                       ("AI_SERVICE_MAX_COURSE_GENERATIONS_PER_USER", 0)):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, **{key: value})
