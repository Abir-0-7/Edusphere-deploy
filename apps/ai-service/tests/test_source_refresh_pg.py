"""F06 migration, owner boundaries and atomic selective refresh on disposable PostgreSQL."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import httpx
import psycopg
import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from app.concept_graph.actions import grounded_graph
from app.concept_graph.store import PgConceptGraphStore
from app.course_generation.contracts import LessonDraft, LessonEditRequest, RefreshPreviewRequest, RefreshStartRequest
from app.course_generation.service import JOB_KIND
from app.errors import ApiError, Conflict, api_error_handler
from app.jobs.worker import Worker
from app.source_refresh.index import PgImpactIndex
from app.source_refresh.router import source_refresh_router
from tests.test_course_generation import lesson
from tests.test_course_generation_pg import generation_database as generation_database
from tests.test_course_generation_pg import harness as harness
from tests.test_course_outlines_pg import outline_database as outline_database
from tests.test_source_refresh import target_approval, updated_snapshot
from tests.test_source_versions_pg import source_database as source_database

MIGRATIONS = Path(__file__).resolve().parents[3] / "packages/db/drizzle"


@pytest.fixture()
def refresh_schema(harness):
    with psycopg.connect(harness["url"], autocommit=True) as conn:
        for name in ("0021_generation_lesson_edits.sql", "0015_concept_graphs.sql", "0009_phase8c.sql"):
            migration = (MIGRATIONS / name).read_text(encoding="utf-8").replace('"public".', "")
            statements = migration.split("--> statement-breakpoint")
            if name == "0009_phase8c.sql":
                # Only the existing course tables are needed for the read-only impact index.
                statements = [
                    statement for statement in statements
                    if any(f'CREATE TABLE IF NOT EXISTS "{table}"' in statement
                           for table in ("courses", "course_releases"))
                ]
            for statement in statements:
                if statement.strip():
                    conn.execute(statement)
        conn.execute("CREATE TABLE flashcards(id uuid PRIMARY KEY, user_id uuid NOT NULL, "
                     "document_id uuid NOT NULL, source_chunk_id uuid, front text, back text, source_revision text)")
    return harness


def _refresh(h):
    calls = []

    def response(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(lesson())}}],
                                        "usage": {"prompt_tokens": 50, "completion_tokens": 70}})

    service, owner = h["service"], h["owner"]
    service.router.client_factory = lambda **kwargs: httpx.Client(transport=httpx.MockTransport(response), **kwargs)
    worker = Worker(h["jobs"], {JOB_KIND: service.handle}, backoff_seconds=0)
    run = service.start(owner, h["request"])
    assert worker.process_one()
    parent = service.get(owner, str(run.id))
    assert parent.status == "done"

    # Initial artifact links remain frozen even when this owned PDF is reprocessed.
    document = h["document"]
    graph = grounded_graph(document)
    graphs = PgConceptGraphStore(h["url"])
    saved_graph = graphs.save(owner, document.id, graph, expected_revision=None)
    before = h["versions"][0]
    replacement = updated_snapshot(before)
    first = replacement.segments[0]
    card_id = uuid4()
    with psycopg.connect(h["url"], autocommit=True) as conn:
        conn.execute("UPDATE chunks SET content=%s WHERE id=%s AND user_id=%s", (first.text, first.id, owner))
        conn.execute("INSERT INTO flashcards VALUES (%s,%s,%s,%s,'Card','Saved answer','r1')",
                     (card_id, owner, document.id, first.id))
    return parent, replacement, worker, calls, saved_graph, card_id


def _save(h, parent, objective, expected):
    return h["service"].edits.save(h["owner"], str(parent.id), objective, LessonEditRequest(
        expected_run_revision=parent.revision, expected_edit_revision=expected,
        output=LessonDraft.model_validate(lesson(f"Saved revision {expected + 1}")),
    ))


def test_pg_impact_and_fork_preserve_edits_and_outbox_atomically(refresh_schema):
    h = refresh_schema
    owner, other, versions = h["owner"], h["other"], h["outlines"].source_versions
    before = h["versions"][0]
    parent, replacement, worker, calls, graph, card_id = _refresh(h)
    after = versions.save(owner, replacement)
    target = target_approval(h["outlines"], owner, parent, before, after, "core")
    _save(h, parent, "core", 0)
    _save(h, parent, "practice", 0)

    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)

    def user(x_user: str = Header(owner)):
        return x_user

    app.include_router(source_refresh_router(user, versions, PgImpactIndex(h["url"]), enabled=True))
    http = TestClient(app)
    path = "/api/source-refresh/impact"
    body = {"old_version_id": str(before.id), "new_version_id": str(after.id)}
    response = http.post(path, json=body)
    assert response.status_code == 200, response.text
    items = response.json()["artifacts"]
    assert {item["kind"] for item in items} == {"card", "map_node", "map_edge", "outline_objective", "generated_lesson"}
    generated, = [item for item in items if item["kind"] == "generated_lesson"]
    assert generated["edited"] and generated["id"] == "core"
    outline, = [item for item in items if item["kind"] == "outline_objective"]
    assert outline["revision"] == parent.outline_revision
    card, = [item for item in items if item["kind"] == "card"]
    assert card["id"] == str(card_id)
    assert http.post(path, json=body, headers={"x-user": other}).status_code == 404
    assert PgConceptGraphStore(h["url"]).get(owner, h["document"].id) == graph

    service = h["service"]
    body = RefreshPreviewRequest(parent_run_id=parent.id, expected_parent_revision=parent.revision, target=target)
    preview = service.refresh_preview(owner, body)
    _save(h, parent, "practice", 1)
    start = RefreshStartRequest(
        **body.model_dump(), id=uuid4(), accept_budget=True, preview_hash=preview.preview_hash,
    )
    with pytest.raises(Conflict, match="parent edits"):
        service.refresh_start(owner, start)
    refreshed_preview = service.refresh_preview(owner, body)
    start = start.model_copy(update={"preview_hash": refreshed_preview.preview_hash})
    # Storage waits are deliberately bounded. An unavailable owner lock must
    # return 503 without creating a partial fork, consuming budget or copying
    # edits. An exact request can be retried when the contention is gone.
    timeout = service.store.timeout_seconds
    try:
        service.store.timeout_seconds = 0.05
        with psycopg.connect(h["url"]) as blocker:
            blocker.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (owner,))
            with pytest.raises(ApiError) as rejected:
                service.refresh_start(owner, start)
            assert rejected.value.status_code == 503
            assert blocker.execute(
                "SELECT count(*) FROM course_generation_runs WHERE id=%s", (start.id,),
            ).fetchone()[0] == 0
            assert blocker.execute("SELECT count(*) FROM jobs").fetchone()[0] == 1
            assert blocker.execute("SELECT count(*) FROM course_generation_lesson_edits").fetchone()[0] == 3
    finally:
        service.store.timeout_seconds = timeout
    assert service.get(owner, str(parent.id)) == parent

    def concurrent_start(_):
        try:
            return service.refresh_start(owner, start)
        except ApiError as exc:
            if exc.status_code != 503:
                raise
            return None  # A bounded contention rejection has no successful write to compare.

    with ThreadPoolExecutor(max_workers=4) as pool:
        attempts = list(pool.map(concurrent_start, range(4)))
    # Retry exactly the same identity after any transient contention. Successful
    # concurrent responses and replay must name one durable fork and one job.
    fork = service.refresh_start(owner, start)
    forks = [item for item in attempts if item is not None]
    assert all((item.id, item.job_id) == (fork.id, fork.job_id) for item in forks)
    assert worker.process_one()
    assert len(calls) == 3
    updated = service.get(owner, str(fork.id))
    assert updated.status == "done" and [stage.attempts for stage in updated.stages] == [1, 0]
    assert updated.stages[1].output == parent.stages[1].output
    assert service.get(owner, str(parent.id)) == parent
    edits = service.edits.list(owner, str(updated.id)).items
    assert [(item.objective_id, item.copied_from_revision) for item in edits] == [("practice", 1), ("practice", 2)]

    with psycopg.connect(h["url"], autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM jobs").fetchone()[0] == 2
        assert conn.execute("SELECT count(*) FROM course_generation_lesson_edits").fetchone()[0] == 5
        with pytest.raises(psycopg.errors.CheckViolation, match="append-only"):
            conn.execute("UPDATE course_generation_lesson_edits SET revision=5 WHERE run_id=%s", (parent.id,))
        with pytest.raises(psycopg.errors.CheckViolation, match="ck_generation_edits_copy"):
            conn.execute("INSERT INTO course_generation_lesson_edits"
                         "(run_id,user_id,objective_id,revision,output,copied_from_run_id) "
                         "VALUES(%s,%s,'test',1,'{}',%s)", (fork.id, owner, parent.id))
        with pytest.raises(psycopg.errors.ForeignKeyViolation, match="fk_generation_edits_run_owner"):
            conn.execute("INSERT INTO course_generation_lesson_edits(run_id,user_id,objective_id,revision,output) "
                         "VALUES(%s,%s,'test',1,'{}')", (fork.id, other))
        conn.execute("DELETE FROM users WHERE id=%s", (owner,))
        assert conn.execute("SELECT count(*) FROM course_generation_lesson_edits").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM course_generation_runs").fetchone()[0] == 0
