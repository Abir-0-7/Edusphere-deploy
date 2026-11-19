"""F04 migration/outbox/checkpoint acceptance on generated disposable PG schemas."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.course_generation.contracts import (
    GenerationApprovalRef,
    GenerationResumeRequest,
    GenerationRun,
    GenerationStartRequest,
    LessonDraft,
)
from app.course_generation.service import GenerationService
from app.course_generation.store import PgGenerationStore
from app.course_outlines.contracts import OutlineCreateRequest, OutlineUpdateRequest
from app.errors import ApiError, Conflict, InvalidInput, NotFound
from app.jobs.postgres_store import PgJobStore, _create_sql
from app.jobs.worker import Claim, Job, LeaseLost, Worker, current_claim
from app.llm.budgets import BudgetLimits, MemoryBudgetStore
from app.llm.cache_scope import PrivateResponseCache
from app.llm.operations import PgOperations
from app.llm.response_cache import PgResponseCache
from app.llm.router import LLMRouter, Provider
from tests.test_course_outlines_pg import _approve, _setup
from tests.test_course_outlines_pg import outline_database as outline_database
from tests.test_source_versions_pg import source_database as source_database


@pytest.fixture()
def generation_database(outline_database):
    with psycopg.connect(outline_database, autocommit=True) as conn:
        conn.execute(_create_sql("jobs"))
        conn.execute("CREATE TABLE ai_operations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL "
                     "REFERENCES users(id) ON DELETE CASCADE, document_id uuid,operation_key varchar(64),state text,"
                     "result text,expires_at timestamptz,created_at timestamptz DEFAULT now(),"
                     "updated_at timestamptz DEFAULT now(),UNIQUE(user_id,operation_key))")
        conn.execute("CREATE TABLE ai_response_cache(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),"
                     "user_id uuid NOT NULL "
                     "REFERENCES users(id) ON DELETE CASCADE,document_id uuid,cache_key varchar(64),content text,"
                     "expires_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),"
                     "UNIQUE(user_id,cache_key))")
        migration = Path(__file__).resolve().parents[3] / "packages/db/drizzle/0020_course_generation.sql"
        for statement in migration.read_text(encoding="utf-8").split("--> statement-breakpoint"):
            if statement.strip():
                conn.execute(statement)
    return outline_database


@pytest.fixture()
def harness(generation_database):
    owner, other, document, versions, outlines, plan = _setup(generation_database)
    saved = outlines.create(owner, OutlineCreateRequest(id=uuid4(), plan=plan))
    approved = _approve(outlines, owner, saved)
    jobs = PgJobStore(generation_database)
    store = PgGenerationStore(generation_database, outlines, jobs)
    router = LLMRouter([Provider("fixture", "https://fixture.invalid", "fixture", None)], max_provider_attempts=1)
    service = GenerationService(store, outlines, jobs, router)
    reference = GenerationApprovalRef(outline_id=approved.id, approval_id=approved.approval.id,
                                      outline_revision=approved.revision, outline_content_hash=approved.content_hash)
    preview = service.preview(owner, reference)
    request = GenerationStartRequest(**reference.model_dump(), id=uuid4(), preview_hash=preview.preview_hash,
                                     accept_budget=True)
    yield {"url": generation_database, "owner": owner, "other": other, "document": document,
           "versions": versions, "outlines": outlines, "approved": approved, "jobs": jobs,
           "store": store, "service": service, "request": request}
    jobs.close()


def _start(h):
    return h["service"].start(h["owner"], h["request"])


def _changed(run, **changes):
    return GenerationRun.model_validate({**run.model_dump(), **changes})


def _claim(h, run, *, now=None):
    now = now or datetime.now(UTC)
    job = h["jobs"].claim_next(now)
    assert job is not None and job.id == str(run.job_id)
    return job, current_claim.set(Claim(h["jobs"], job, lambda: now))


def _allocated(run):
    stages = [stage.model_copy(deep=True) for stage in run.stages]
    stages[0].status, stages[0].attempts = "running", 1
    return _changed(run, status="running", stages=stages, allocated_tokens=stages[0].token_upper_bound)


def test_create_outbox_and_idempotent_replay_are_owner_scoped(harness):
    h = harness
    run = _start(h)
    assert h["service"].start(h["owner"], h["request"]) == run
    assert h["jobs"].get(str(run.job_id), h["owner"]).payload["generation_id"] == str(run.id)
    assert h["jobs"].get(str(run.job_id), h["other"]) is None
    assert h["store"].list(h["owner"]).items[0].completed_stages == 0
    assert h["store"].list(h["other"]).total_count == 0
    with pytest.raises(NotFound):
        h["store"].get(h["other"], run.id)
    with psycopg.connect(h["url"]) as conn:
        assert conn.execute("SELECT count(*) FROM jobs").fetchone()[0] == 1


def test_creation_rejects_stale_current_approval_without_queue_side_effects(harness):
    h = harness
    run = _start(h)
    h["outlines"].update(h["owner"], run.outline_id, OutlineUpdateRequest(
        expected_revision=run.outline_revision, plan=run.plan))
    with pytest.raises(Conflict):
        h["store"].create(h["owner"], _changed(run, id=uuid4(), job_id=uuid4()))
    # The existing run retains the exact historical approval after an outline edit.
    assert h["store"].get(h["owner"], run.id).plan == run.plan
    with psycopg.connect(h["url"]) as conn:
        assert conn.execute("SELECT count(*) FROM jobs").fetchone()[0] == 1


def test_job_collision_rolls_back_new_generation_and_preserves_existing_payload(harness):
    h = harness
    run = _start(h)
    collision = uuid4()
    h["jobs"].add(Job(str(collision), "another_kind", {"user_id": h["owner"]}))
    with pytest.raises(Conflict):
        h["store"].create(h["owner"], _changed(run, id=uuid4(), job_id=collision))
    assert h["store"].list(h["owner"]).total_count == 1
    assert h["jobs"].get(str(collision), h["owner"]).kind == "another_kind"


def test_checkpoint_cas_race_has_one_winner_and_keeps_allocation(harness):
    h = harness
    run = _start(h)
    replacement = _allocated(run)

    def write(_):
        try:
            return h["store"].save(h["owner"], replacement, run.revision)
        except Conflict:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, range(2)))
    assert sum(result is not None for result in results) == 1
    saved = h["store"].get(h["owner"], run.id)
    assert saved.revision == 2 and saved.allocated_tokens == replacement.allocated_tokens
    with pytest.raises(Conflict, match="allocated"):
        h["store"].save(h["owner"], _changed(saved, stages=run.stages, allocated_tokens=0), saved.revision)


def test_cancel_resume_atomically_revokes_old_lease_and_enqueues_successor(harness):
    h = harness
    run = _start(h)
    _, token = _claim(h, run)
    try:
        run = h["store"].save(h["owner"], _allocated(run), run.revision, fenced=True)
        cancelled = h["store"].save(h["owner"], _changed(run, status="cancelled"), run.revision, cancel=True)
        assert h["jobs"].get(str(run.job_id), h["owner"]).status == "cancelled"
        with pytest.raises(LeaseLost):
            h["store"].save(h["owner"], _changed(cancelled, status="running"), cancelled.revision, fenced=True)
        resumed = h["store"].save(h["owner"], _changed(cancelled, status="pending", job_id=uuid4()),
                                   cancelled.revision, enqueue=True)
        assert resumed.allocated_tokens == run.allocated_tokens
        assert resumed.stages == run.stages
        assert h["jobs"].get(str(resumed.job_id), h["owner"]).status == "pending"
        with pytest.raises(LeaseLost):
            h["store"].save(h["owner"], _changed(resumed, status="running"), resumed.revision, fenced=True)
    finally:
        current_claim.reset(token)


def test_worker_restart_reclaims_run_and_stale_token_cannot_checkpoint(harness):
    h = harness
    run = _start(h)
    now = datetime.now(UTC)
    job, token = _claim(h, run, now=now)
    try:
        run = h["store"].save(h["owner"], _allocated(run), run.revision, fenced=True)
        restarted = PgJobStore(h["url"])
        try:
            later = now + timedelta(seconds=h["jobs"].lease_seconds + 1)
            reclaimed = restarted.claim_next(later)
            assert reclaimed.id == job.id and reclaimed.lease_token != job.lease_token
            with pytest.raises(LeaseLost):
                h["store"].save(h["owner"], run, run.revision, fenced=True)
            new_token = current_claim.set(Claim(restarted, reclaimed, lambda: later))
            try:
                saved = h["store"].save(h["owner"], run, run.revision, fenced=True)
                assert saved.allocated_tokens == run.allocated_tokens and saved.stages == run.stages
            finally:
                current_claim.reset(new_token)
        finally:
            restarted.close()
    finally:
        current_claim.reset(token)


def test_owner_fks_cover_approval_and_ai_content(harness):
    h = harness
    run = _start(h)
    with psycopg.connect(h["url"], autocommit=True) as conn:
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            conn.execute("INSERT INTO course_generation_runs(id,user_id,outline_id,approval_id,state) "
                         "VALUES(%s,%s,%s,%s,%s)", (uuid4(), h["other"], run.outline_id, run.approval_id,
                                                  Jsonb(run.model_dump(mode="json"))))
        for table in ("ai_operations", "ai_response_cache"):
            with pytest.raises(psycopg.errors.ForeignKeyViolation):
                conn.execute(f"INSERT INTO {table}(user_id,generation_run_id) VALUES(%s,%s)",
                             (h["other"], run.id))


@pytest.mark.parametrize("deleted", ["document", "outline", "account"])
def test_source_outline_account_delete_cascade_runs_jobs_and_private_ai_content(harness, deleted):
    h = harness
    run = _start(h)
    with psycopg.connect(h["url"], autocommit=True) as conn:
        for table in ("ai_operations", "ai_response_cache"):
            conn.execute(f"INSERT INTO {table}(user_id,generation_run_id) VALUES(%s,%s)", (h["owner"], run.id))
        table, identifier = {"document": ("documents", h["document"].id),
                             "outline": ("course_outlines", run.outline_id), "account": ("users", h["owner"])}[deleted]
        conn.execute(f"DELETE FROM {table} WHERE id=%s", (identifier,))
        for child in ("course_generation_runs", "jobs", "ai_operations", "ai_response_cache"):
            assert conn.execute(f"SELECT count(*) FROM {child}").fetchone()[0] == 0
    with pytest.raises(NotFound):
        h["store"].get(h["owner"], run.id)


def test_run_quota_is_atomic_under_concurrent_creates(harness):
    h = harness
    run = _start(h)
    h["store"].max_runs_per_user = 2

    def create(_):
        try:
            return h["store"].create(h["owner"], _changed(run, id=uuid4(), job_id=uuid4()))
        except InvalidInput:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert sum(result is not None for result in results) == 1
    assert h["store"].list(h["owner"]).total_count == 2
    with psycopg.connect(h["url"]) as conn:
        assert conn.execute("SELECT count(*) FROM jobs").fetchone()[0] == 2


def test_checkpoint_lock_timeout_rolls_back_run_and_job_changes(harness):
    h = harness
    run = _start(h)
    store = PgGenerationStore(h["url"], h["outlines"], h["jobs"], timeout_seconds=0.05)
    with psycopg.connect(h["url"]) as blocking:
        blocking.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (h["owner"],))
        with pytest.raises(ApiError) as failed:
            store.save(h["owner"], _changed(run, status="cancelled"), run.revision, cancel=True)
        assert failed.value.status_code == 503
    assert h["store"].get(h["owner"], run.id) == run
    assert h["jobs"].get(str(run.job_id), h["owner"]).status == "pending"


def test_completed_stage_cannot_be_overwritten_or_removed(harness):
    h = harness
    run = _start(h)
    run = h["store"].save(h["owner"], _allocated(run), run.revision)
    stages = [stage.model_copy(deep=True) for stage in run.stages]
    stages[0].status = "done"
    stages[0].output = LessonDraft(title="Reviewed private draft", explanation="An explanation.",
                                   worked_example="A bounded example.", question="What is supported?",
                                   answer="The linked evidence.", evidence_ids=["pin-1"])
    run = h["store"].save(h["owner"], _changed(run, stages=stages), run.revision)
    stages = [stage.model_copy(deep=True) for stage in run.stages]
    stages[0].output.explanation = "An attempted overwrite."
    with pytest.raises(Conflict, match="Completed"):
        h["store"].save(h["owner"], _changed(run, stages=stages), run.revision)
    stages[0].status, stages[0].output = "running", None
    with pytest.raises(Conflict, match="Completed"):
        h["store"].save(h["owner"], _changed(run, stages=stages), run.revision)


def test_list_reconciles_failed_and_cancelled_job_summary_without_mutating_run(harness):
    h = harness
    run = _start(h)
    claimed = h["jobs"].claim_next(datetime.now(UTC))
    h["jobs"].mark_failed(str(run.job_id), "Fixture worker exhaustion", lease_token=claimed.lease_token)
    assert h["store"].list(h["owner"]).items[0].status == "failed"
    assert h["store"].get(h["owner"], run.id).status == "pending"
    second = h["store"].create(h["owner"], _changed(run, id=uuid4(), job_id=uuid4()))
    h["jobs"].request_cancel(str(second.job_id), h["owner"])
    statuses = {item.id: item.status for item in h["store"].list(h["owner"]).items}
    assert statuses[second.id] == "cancelled" and statuses[run.id] == "failed"


def _pg_generation_worker(h, *, delete_on_resume=None):
    """Actual SQL operations/cache stores with a controlled, inert HTTP provider."""
    calls = []
    router = h["service"].router
    operations = PgOperations(h["url"])
    cache = PgResponseCache(h["url"], max_content_chars=32000, max_entries_per_user=100)
    budgets = MemoryBudgetStore()

    def transport(request):
        data = json.loads(request.content)
        calls.append(data)
        if len(calls) == 2:
            return httpx.Response(503)
        if len(calls) == 3 and delete_on_resume is not None:
            run = h["store"].get(h["owner"], h["request"].id)
            table, identifier = {"source": ("documents", h["document"].id),
                                 "outline": ("course_outlines", run.outline_id)}[delete_on_resume]
            with psycopg.connect(h["url"], autocommit=True) as conn:
                conn.execute(f"DELETE FROM {table} WHERE id=%s", (identifier,))
        lesson = {"title": "Evidence-linked draft", "explanation": "Explain the selected source's main claim.",
                  "worked_example": "Apply only the quoted evidence in a bounded example.",
                  "question": "What does the cited material support?", "answer": "The chosen objective.",
                  "evidence_ids": ["pin-1"]}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(lesson)}}],
                                        "usage": {"prompt_tokens": 10, "completion_tokens": 20}})

    router.operations = operations
    router.cache = PrivateResponseCache(cache, 3600)
    router.budget_store = budgets
    router.budget_limits = BudgetLimits(10000000, 10000000, 10000000, 10, 10, 300)
    router.client_factory = lambda **kwargs: httpx.Client(transport=httpx.MockTransport(transport), **kwargs)
    worker = Worker(h["jobs"], {"generate_course_modules": h["service"].handle}, backoff_seconds=0)
    return worker, calls, operations, cache, budgets


def _outage_then_resume(h, worker):
    run = _start(h)
    assert worker.process_one()
    failed = h["store"].get(h["owner"], run.id)
    assert failed.status == "failed" and failed.stages[0].status == "done"
    assert failed.stages[1].status == "needs_retry" and failed.stages[1].error_code == "provider_unavailable"
    with psycopg.connect(h["url"]) as conn:
        ops = conn.execute("SELECT state,generation_run_id FROM ai_operations ORDER BY created_at").fetchall()
        assert len(ops) == 2 and {row[0] for row in ops} == {"succeeded", "uncertain"}
        assert all(str(row[1]) == str(run.id) for row in ops)
        cached = conn.execute("SELECT generation_run_id FROM ai_response_cache").fetchall()
        assert len(cached) == 1 and str(cached[0][0]) == str(run.id)
    resumed = h["service"].resume(h["owner"], str(run.id), GenerationResumeRequest(
        expected_revision=failed.revision, accept_remaining_budget=True))
    assert resumed.job_id != failed.job_id and resumed.stages[0] == failed.stages[0]
    assert resumed.allocated_tokens == failed.allocated_tokens
    return failed, resumed


def test_real_pg_operations_cache_and_worker_reuse_checkpoints_after_outage(harness):
    h = harness
    worker, calls, _operations, _cache, budgets = _pg_generation_worker(h)
    failed, resumed = _outage_then_resume(h, worker)
    assert worker.process_one()
    saved = PgGenerationStore(h["url"], h["outlines"], h["jobs"]).get(h["owner"], resumed.id)
    assert saved.status == "done" and saved.stages[0] == failed.stages[0]
    assert [stage.attempts for stage in saved.stages] == [1, 2] and len(calls) == 3
    assert saved.allocated_tokens == failed.allocated_tokens + saved.stages[1].token_upper_bound
    charges = list(budgets.rows.values())
    assert len(charges) == 3 and charges[1].actual_tokens == charges[1].reserved_tokens
    with psycopg.connect(h["url"]) as conn:
        assert conn.execute("SELECT count(*) FROM ai_operations WHERE generation_run_id=%s", (saved.id,)) \
            .fetchone()[0] == 3
        assert conn.execute("SELECT count(*) FROM ai_response_cache WHERE generation_run_id=%s", (saved.id,)) \
            .fetchone()[0] == 2
        assert conn.execute("SELECT count(*) FROM ai_operations WHERE generation_run_id IS NULL").fetchone()[0] == 0


@pytest.mark.parametrize("deleted", ["source", "outline"])
def test_real_pg_provider_completion_cannot_recreate_deleted_generation_content(harness, deleted):
    h = harness
    worker, calls, operations, cache, budgets = _pg_generation_worker(h, delete_on_resume=deleted)
    failed, _resumed = _outage_then_resume(h, worker)
    with psycopg.connect(h["url"]) as conn:
        operation_key = conn.execute("SELECT operation_key FROM ai_operations WHERE state='succeeded'").fetchone()[0]
        cache_key = conn.execute("SELECT cache_key FROM ai_response_cache").fetchone()[0]
    # Deletion wins inside the resumed provider's successful response. Its queued
    # lease, run, prior checkpoints and all raw generated content disappear.
    assert worker.process_one() and len(calls) == 3
    with pytest.raises(NotFound):
        h["store"].get(h["owner"], failed.id)
    operations.settle(h["owner"], operation_key, "late private response", True)
    assert not cache.put(h["owner"], cache_key, "late private response", 3600,
                         generation_run_id=str(failed.id))
    assert cache.get(h["owner"], cache_key, generation_run_id=str(failed.id)) is None
    with pytest.raises(ApiError) as rejected:
        operations.claim(h["owner"], "d" * 64, generation_run_id=str(failed.id))
    assert rejected.value.status_code == 404
    with psycopg.connect(h["url"]) as conn:
        for table in ("course_generation_runs", "jobs", "ai_operations", "ai_response_cache"):
            assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
    assert len(budgets.rows) == 3  # metadata charges survive; content cannot return
