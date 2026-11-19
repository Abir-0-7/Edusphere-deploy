"""Owner-scoped resumable private drafts with an atomic jobs-table outbox."""

import math
import threading
from contextlib import contextmanager
from datetime import UTC, datetime

from app.course_generation.contracts import GenerationListResponse, GenerationRun, GenerationSummary
from app.course_outlines.contracts import OutlinePlan
from app.errors import ApiError, Conflict, InvalidInput, NotFound
from app.jobs.worker import InMemoryJobStore, Job, LeaseLost, current_claim

GENERATION_JOB = "generate_course_modules"
_IMMUTABLE = {"id", "outline_id", "approval_id", "outline_revision", "outline_content_hash", "plan",
              "preview_hash", "policy", "maximum_tokens", "created_at", "visibility", "editorial_status",
              "parent_run_id", "parent_run_revision", "refresh_preview_hash", "regenerate_objective_ids"}


def _now():
    return datetime.now(UTC).isoformat()


def _limits(maximum, timeout):
    if type(maximum) is not int or not 1 <= maximum <= 1000:
        raise ValueError("generation run limit must be a positive bounded integer")
    if isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("generation storage timeout must be positive and finite")


def _page(limit, offset):
    if type(limit) is not int or not 1 <= limit <= 50 or type(offset) is not int or offset < 0:
        raise InvalidInput("Invalid generation pagination")


def _run(value):
    parsed = GenerationRun.model_validate(value.model_dump(mode="json") if isinstance(value, GenerationRun) else value)
    if len(parsed.model_dump_json().encode("utf-8")) > 1_900_000:
        raise InvalidInput("Generation draft exceeds the storage limit")
    return parsed


def _summary(run, job_status="present"):
    status = run.status
    if status in {"pending", "running"} and job_status in {None, "failed", "cancelled"}:
        status = "cancelled" if job_status == "cancelled" else "failed"
    return GenerationSummary(
        id=run.id, outline_id=run.outline_id, title=run.plan.title, status=status,
        completed_stages=sum(stage.status == "done" for stage in run.stages), total_stages=len(run.stages),
        maximum_tokens=run.maximum_tokens, allocated_tokens=run.allocated_tokens, updated_at=run.updated_at,
    )


def _replacement(old, new, expected_revision):
    if old.revision != expected_revision or new.revision != expected_revision:
        raise Conflict("Generation changed; reload before continuing")
    if old.model_dump(mode="json", include=_IMMUTABLE) != new.model_dump(mode="json", include=_IMMUTABLE):
        raise Conflict("A generation run cannot change its approved scope or budget policy")
    if new.allocated_tokens < old.allocated_tokens:
        raise Conflict("Previously allocated generation budget cannot be removed")
    for previous, following in zip(old.stages, new.stages, strict=True):
        metadata = {"id", "module_id", "title", "input_bytes", "token_upper_bound", "reuse"}
        if previous.model_dump(include=metadata) != following.model_dump(include=metadata):
            raise Conflict("Generation stage inputs and estimates cannot change")
        if following.attempts < previous.attempts or (previous.status == "done" and following != previous):
            raise Conflict("Completed generation stages and prior attempts must be retained")
    if old.status == "done" and new.status != "done":
        raise Conflict("Completed generation runs cannot be reopened")
    return _run(new.model_copy(update={"revision": old.revision + 1, "updated_at": _now()}))


def _job(user_id, run):
    return Job(
        id=str(run.job_id), kind=GENERATION_JOB,
        payload={"user_id": user_id, "job_id": str(run.job_id), "generation_id": str(run.id)},
        dedupe_key=f"course-generation:{run.id}:{run.job_id}",
    )


def _claim(run, user_id):
    claim = current_claim.get()
    if (claim is None or claim.job.id != str(run.job_id) or claim.job.kind != GENERATION_JOB
            or claim.job.payload.get("user_id") != user_id
            or claim.job.payload.get("generation_id") != str(run.id)):
        raise LeaseLost("Generation write requires its active owner-scoped job claim")
    return claim


class MemoryGenerationStore:
    def __init__(self, outline_store, job_store=None, *, max_runs_per_user=10, timeout_seconds=5):
        _limits(max_runs_per_user, timeout_seconds)
        self.outline_store = outline_store
        self.job_store = job_store if job_store is not None else InMemoryJobStore()
        self.max_runs_per_user, self.timeout_seconds = max_runs_per_user, timeout_seconds
        self._lock = threading.RLock()
        self._rows: dict[str, tuple[str, GenerationRun]] = {}

    def _approved(self, user_id, run, *, current=False):
        outline = self.outline_store.get(user_id, str(run.outline_id))
        approvals = self.outline_store.history(user_id, str(run.outline_id)).items
        approval = next((item for item in approvals if item.id == run.approval_id), None)
        if (approval is None or approval.revision != run.outline_revision
                or approval.content_hash != run.outline_content_hash or approval.snapshot.plan != run.plan):
            raise Conflict("Generation approval no longer matches its saved scope")
        if current and (outline.status != "approved" or outline.approval is None
                        or outline.approval.id != run.approval_id or outline.revision != run.outline_revision
                        or outline.content_hash != run.outline_content_hash):
            raise Conflict("Review and approve the current outline before starting generation")

    def _purge(self, user_id):
        for identifier, (owner, run) in list(self._rows.items()):
            if owner != user_id:
                continue
            try:
                self._approved(owner, run)
            except NotFound:
                del self._rows[identifier]
                for job_id, job in list(self.job_store.jobs.items()):
                    if job.payload.get("user_id") == owner and job.payload.get("generation_id") == identifier:
                        del self.job_store.jobs[job_id]

    def _owned(self, user_id, identifier):
        row = self._rows.get(str(identifier))
        if row is None or row[0] != user_id:
            raise NotFound("Generation not found")
        self._approved(user_id, row[1])
        return _run(row[1])

    def create(self, user_id, run):
        run = _run(run)
        with self.outline_store._lock, self._lock, self.job_store._lock:
            self._purge(user_id)
            existing = self._rows.get(str(run.id))
            if existing is not None:
                old = self._owned(user_id, run.id)
                if old.preview_hash != run.preview_hash:
                    raise Conflict("Generation identifier already has a different scope")
                return old
            self._approved(user_id, run, current=True)
            if run.parent_run_id is not None or any(stage.reuse is not None for stage in run.stages):
                raise InvalidInput("Reused lessons require an owner-validated refresh fork")
            if run.revision != 1 or run.status != "pending" or run.allocated_tokens:
                raise InvalidInput("New generation must be an unallocated pending draft")
            if sum(owner == user_id for owner, _ in self._rows.values()) >= self.max_runs_per_user:
                raise InvalidInput("Generation limit reached for this account")
            job = _job(user_id, run)
            if self.job_store.add(job).payload != job.payload:
                raise Conflict("Generation job identity is already in use")
            self._rows[str(run.id)] = (user_id, run)
            return _run(run)

    def create_fork(self, user_id, body, edits, builder):
        from app.course_generation.refresh import replay, validated_target

        with self.outline_store._lock, self._lock, self.job_store._lock, edits._lock:
            self._purge(user_id)
            if str(body.id) in self._rows:
                return replay(self._owned(user_id, body.id), body)
            parent = self._owned(user_id, body.parent_run_id)
            target = self.outline_store.get(user_id, str(body.target.outline_id))
            plan = validated_target(target, body.target)
            history = edits._history(user_id, parent.id)
            run = _run(builder(parent, plan, history))
            if sum(owner == user_id for owner, _ in self._rows.values()) >= self.max_runs_per_user:
                raise InvalidInput("Generation limit reached for this account")
            job = _job(user_id, run)
            if self.job_store.add(job).payload != job.payload:
                raise Conflict("Generation job identity is already in use")
            self._rows[str(run.id)] = (user_id, run)
            edits._copy(user_id, run.id, history, {stage.id for stage in run.stages if stage.reuse is not None})
            return _run(run)

    def get(self, user_id, identifier):
        with self.outline_store._lock, self._lock, self.job_store._lock:
            self._purge(user_id)
            return self._owned(user_id, identifier)

    def list(self, user_id, *, limit=20, offset=0):
        _page(limit, offset)
        with self.outline_store._lock, self._lock, self.job_store._lock:
            self._purge(user_id)
            rows = sorted((run for owner, run in self._rows.values() if owner == user_id),
                          key=lambda run: (run.updated_at, str(run.id)), reverse=True)
            summaries = []
            for run in rows[offset:offset + limit]:
                job = self.job_store.get(str(run.job_id), user_id)
                summaries.append(_summary(run, job.status if job else None))
            return GenerationListResponse(items=summaries,
                                          limit=limit, offset=offset, total_count=len(rows))

    def save(self, user_id, run, expected_revision, *, enqueue=False, cancel=False, fenced=False):
        run = _run(run)
        with self.outline_store._lock, self._lock, self.job_store._lock:
            self._purge(user_id)
            old = self._owned(user_id, run.id)
            if fenced:
                claim = _claim(old, user_id)
                claim.check()
            saved = _replacement(old, run, expected_revision)
            if old.job_id != saved.job_id and not enqueue:
                raise Conflict("A replacement generation job must be atomically enqueued")
            if enqueue:
                job = _job(user_id, saved)
                if self.job_store.add(job).payload != job.payload:
                    raise Conflict("Generation job identity is already in use")
            if cancel or enqueue and old.job_id != saved.job_id:
                self.job_store.request_cancel(str(old.job_id), user_id)
            self._rows[str(saved.id)] = (user_id, saved)
            return _run(saved)


class PgGenerationStore:
    def __init__(self, database_url, outline_store, job_store=None, *, max_runs_per_user=10, timeout_seconds=5):
        _limits(max_runs_per_user, timeout_seconds)
        self.database_url, self.outline_store, self.job_store = database_url, outline_store, job_store
        self.max_runs_per_user, self.timeout_seconds = max_runs_per_user, timeout_seconds

    @contextmanager
    def _connection(self):
        import psycopg
        from psycopg.rows import dict_row

        try:
            with psycopg.connect(self.database_url, row_factory=dict_row, connect_timeout=5) as conn:
                milliseconds = max(1, int(self.timeout_seconds * 1000))
                conn.execute("SELECT set_config('statement_timeout',%s,true),set_config('lock_timeout',%s,true)",
                             (f"{milliseconds}ms", f"{milliseconds}ms"))
                yield conn
        except (psycopg.OperationalError, psycopg.errors.QueryCanceled, psycopg.errors.LockNotAvailable) as exc:
            raise ApiError("Generation storage is temporarily unavailable", status_code=503) from exc

    @staticmethod
    def _row(conn, user_id, identifier, *, lock=False):
        row = conn.execute("SELECT * FROM course_generation_runs WHERE id=%s AND user_id=%s"
                           + (" FOR UPDATE" if lock else ""), (str(identifier), user_id)).fetchone()
        if row is None:
            raise NotFound("Generation not found")
        return row

    @staticmethod
    def _decode(row):
        run = _run(row["state"])
        if (str(run.id) != str(row["id"]) or str(run.outline_id) != str(row["outline_id"])
                or str(run.approval_id) != str(row["approval_id"]) or str(run.job_id) != str(row["active_job_id"])
                or run.revision != row["revision"]):
            raise Conflict("Stored generation metadata is inconsistent")
        return run

    def _approved(self, conn, user_id, run, *, lock=False, current=False):
        self.outline_store._sources(conn, user_id, str(run.outline_id), run.plan, lock=lock)
        outline = self.outline_store._row(conn, user_id, str(run.outline_id), lock=lock)
        approval = conn.execute(
            "SELECT revision,content_hash,snapshot FROM course_outline_approvals "
            "WHERE id=%s AND user_id=%s AND outline_id=%s", (str(run.approval_id), user_id, str(run.outline_id)),
        ).fetchone()
        if (approval is None or approval["revision"] != run.outline_revision
                or approval["content_hash"] != run.outline_content_hash
                or OutlinePlan.model_validate(approval["snapshot"]["plan"]) != run.plan):
            raise Conflict("Generation approval no longer matches its saved scope")
        if current and (outline["status"] != "approved" or outline["revision"] != run.outline_revision
                        or outline["content_hash"] != run.outline_content_hash
                        or outline["approved_revision"] != run.outline_revision):
            raise Conflict("Review and approve the current outline before starting generation")

    def _job_table(self):
        return self.job_store._table if self.job_store is not None else "jobs"

    def _enqueue(self, conn, user_id, run):
        from psycopg.types.json import Jsonb

        job = _job(user_id, run)
        table = self._job_table()
        conn.execute(f"INSERT INTO {table}(id,kind,payload,dedupe_key) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                     (job.id, job.kind, Jsonb(job.payload), job.dedupe_key))
        row = conn.execute(f"SELECT kind,payload FROM {table} WHERE id=%s FOR UPDATE", (job.id,)).fetchone()
        if row is None or row["kind"] != job.kind or row["payload"] != job.payload:
            raise Conflict("Generation job identity is already in use")

    def _cancel(self, conn, user_id, job_id):
        conn.execute(f"UPDATE {self._job_table()} SET cancel_requested=true,status='cancelled',"
                     "lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=%s "
                     "AND payload->>'user_id'=%s AND kind=%s AND status IN ('pending','running')",
                     (str(job_id), user_id, GENERATION_JOB))

    def _fence(self, conn, user_id, run):
        claim = _claim(run, user_id)
        row = conn.execute(f"SELECT id FROM {self._job_table()} WHERE id=%s AND kind=%s "
                           "AND payload->>'user_id'=%s AND payload->>'generation_id'=%s "
                           "AND status='running' AND NOT cancel_requested AND lease_token=%s "
                           "AND lease_expires_at>%s FOR UPDATE",
                           (str(run.job_id), GENERATION_JOB, user_id, str(run.id), claim.job.lease_token,
                            claim.clock())).fetchone()
        if row is None:
            raise LeaseLost("Generation job lease expired or was cancelled")

    def create(self, user_id, run):
        import psycopg
        from psycopg.types.json import Jsonb

        run = _run(run)
        try:
            with self._connection() as conn:
                self.outline_store._owner(conn, user_id)
                existing = conn.execute("SELECT user_id FROM course_generation_runs WHERE id=%s",
                                        (str(run.id),)).fetchone()
                if existing is not None:
                    old = self._decode(self._row(conn, user_id, run.id))
                    self._approved(conn, user_id, old)
                    if old.preview_hash != run.preview_hash:
                        raise Conflict("Generation identifier already has a different scope")
                    return old
                self._approved(conn, user_id, run, lock=True, current=True)
                if run.parent_run_id is not None or any(stage.reuse is not None for stage in run.stages):
                    raise InvalidInput("Reused lessons require an owner-validated refresh fork")
                if run.revision != 1 or run.status != "pending" or run.allocated_tokens:
                    raise InvalidInput("New generation must be an unallocated pending draft")
                count = conn.execute("SELECT count(*) AS count FROM course_generation_runs WHERE user_id=%s",
                                     (user_id,)).fetchone()["count"]
                if count >= self.max_runs_per_user:
                    raise InvalidInput("Generation limit reached for this account")
                conn.execute("INSERT INTO course_generation_runs(id,user_id,outline_id,approval_id,active_job_id,"
                             "revision,state,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                             (str(run.id), user_id, str(run.outline_id), str(run.approval_id), str(run.job_id),
                              run.revision, Jsonb(run.model_dump(mode="json")), run.created_at, run.updated_at))
                self._enqueue(conn, user_id, run)
                return run
        except psycopg.errors.UniqueViolation as exc:
            raise Conflict("Generation identity is already in use") from exc

    def create_fork(self, user_id, body, edits, builder):
        from psycopg.types.json import Jsonb

        from app.course_generation.refresh import replay, validated_target

        with self._connection() as conn:
            self.outline_store._owner(conn, user_id)
            existing = conn.execute("SELECT user_id FROM course_generation_runs WHERE id=%s",
                                    (str(body.id),)).fetchone()
            if existing is not None:
                saved = self._decode(self._row(conn, user_id, body.id))
                self._approved(conn, user_id, saved)
                return replay(saved, body)
            candidate = self._decode(self._row(conn, user_id, body.parent_run_id))
            # Acquire every source before outline/run rows. Both approvals and
            # the append-only edit ledger are checked again under owner lock.
            targets = {str(candidate.outline_id): candidate.plan}
            target_row = self.outline_store._row(conn, user_id, str(body.target.outline_id))
            targets[str(body.target.outline_id)] = OutlinePlan.model_validate(target_row["plan"])
            for identifier, plan in sorted(targets.items()):
                self.outline_store._sources(conn, user_id, identifier, plan, lock=True)
            for identifier in sorted(targets):
                self.outline_store._row(conn, user_id, identifier, lock=True)
            self._approved(conn, user_id, candidate)
            parent = self._decode(self._row(conn, user_id, body.parent_run_id, lock=True))
            target_row = self.outline_store._row(conn, user_id, str(body.target.outline_id))
            target = self.outline_store._record(conn, user_id, target_row)
            plan = validated_target(target, body.target)
            history = edits._history(conn, user_id, parent.id)
            run = _run(builder(parent, plan, history))
            count = conn.execute("SELECT count(*) AS count FROM course_generation_runs WHERE user_id=%s",
                                 (user_id,)).fetchone()["count"]
            if count >= self.max_runs_per_user:
                raise InvalidInput("Generation limit reached for this account")
            conn.execute("INSERT INTO course_generation_runs(id,user_id,outline_id,approval_id,active_job_id,"
                         "revision,state,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                         (str(run.id), user_id, str(run.outline_id), str(run.approval_id), str(run.job_id),
                          run.revision, Jsonb(run.model_dump(mode="json")), run.created_at, run.updated_at))
            self._enqueue(conn, user_id, run)
            edits._copy(conn, user_id, run.id, history, {stage.id for stage in run.stages if stage.reuse is not None})
            return run

    def get(self, user_id, identifier):
        with self._connection() as conn:
            run = self._decode(self._row(conn, user_id, identifier))
            self._approved(conn, user_id, run)
            return run

    def list(self, user_id, *, limit=20, offset=0):
        _page(limit, offset)
        with self._connection() as conn:
            rows = conn.execute(
                f"SELECT g.*,j.status AS queue_status FROM course_generation_runs g LEFT JOIN {self._job_table()} j "
                "ON j.id=g.active_job_id AND j.payload->>'user_id'=g.user_id::text "
                "AND j.payload->>'generation_id'=g.id::text AND j.kind=%s WHERE g.user_id=%s "
                "ORDER BY g.updated_at DESC,g.id DESC LIMIT %s OFFSET %s",
                (GENERATION_JOB, user_id, limit, offset)).fetchall()
            runs = [self._decode(row) for row in rows]
            for run in runs:
                self._approved(conn, user_id, run)
            total = conn.execute("SELECT count(*) AS count FROM course_generation_runs WHERE user_id=%s",
                                 (user_id,)).fetchone()["count"]
            return GenerationListResponse(items=[_summary(run, row["queue_status"])
                                                 for run, row in zip(runs, rows, strict=True)],
                                          limit=limit, offset=offset,
                                          total_count=total)

    def save(self, user_id, run, expected_revision, *, enqueue=False, cancel=False, fenced=False):
        from psycopg.types.json import Jsonb

        run = _run(run)
        with self._connection() as conn:
            self.outline_store._owner(conn, user_id)
            self._approved(conn, user_id, run, lock=True)
            old = self._decode(self._row(conn, user_id, run.id, lock=True))
            if fenced:
                self._fence(conn, user_id, old)
            saved = _replacement(old, run, expected_revision)
            if old.job_id != saved.job_id and not enqueue:
                raise Conflict("A replacement generation job must be atomically enqueued")
            if cancel or enqueue and old.job_id != saved.job_id:
                self._cancel(conn, user_id, old.job_id)
            if enqueue:
                self._enqueue(conn, user_id, saved)
            conn.execute("UPDATE course_generation_runs SET active_job_id=%s,revision=%s,state=%s,updated_at=%s "
                         "WHERE id=%s AND user_id=%s", (str(saved.job_id), saved.revision,
                                                       Jsonb(saved.model_dump(mode="json")), saved.updated_at,
                                                       str(saved.id), user_id))
            return saved
