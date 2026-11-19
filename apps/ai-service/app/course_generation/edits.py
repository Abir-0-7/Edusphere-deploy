"""Append-only owner lesson overlays. Raw generation checkpoints remain immutable."""

import threading
from datetime import UTC, datetime

from app.course_generation.contracts import GenerationLessonEdit, LessonDraft, LessonEditListResponse, LessonEditRequest
from app.errors import Conflict, InvalidInput


def _limit(value):
    if type(value) is not int or not 1 <= value <= 5:
        raise ValueError("lesson edit history limit must be an integer between one and five")


def _validate(run, objective_id, body, maximum, history):
    body = LessonEditRequest.model_validate(body.model_dump(mode="json"))
    if run.revision != body.expected_run_revision:
        raise Conflict("Generation changed; reload before editing a lesson")
    objective = next((item for item in run.plan.objectives if item.id == objective_id), None)
    stage = next((item for item in run.stages if item.id == objective_id), None)
    if objective is None or stage is None or stage.status != "done":
        raise InvalidInput("Only a completed lesson in this exact generation can be edited")
    if body.expected_edit_revision != len(history):
        raise Conflict("Lesson edit changed; reload before saving")
    if len(history) >= maximum:
        raise InvalidInput("Lesson edit history limit reached; retained versions were kept")
    allowed = {f"pin-{index + 1}" for index in range(len(objective.evidence))}
    if not set(body.output.evidence_ids) <= allowed:
        raise InvalidInput("Edited lesson evidence must use this exact objective's approved pins")
    return GenerationLessonEdit(run_id=run.id, objective_id=objective_id, revision=len(history) + 1,
                                output=body.output, created_at=datetime.now(UTC).isoformat())


class MemoryGenerationEditStore:
    def __init__(self, generations, *, max_revisions_per_lesson=5):
        _limit(max_revisions_per_lesson)
        self.generations, self.max_revisions_per_lesson = generations, max_revisions_per_lesson
        self._lock = threading.RLock()
        self._rows = {}

    def _history(self, user_id, run_id):
        return [item.model_copy(deep=True) for (owner, run, _objective), items in self._rows.items()
                if owner == user_id and run == str(run_id) for item in items]

    def list(self, user_id, run_id):
        with self.generations.outline_store._lock, self.generations._lock, self._lock:
            self.generations.get(user_id, run_id)
            return LessonEditListResponse(items=sorted(self._history(user_id, run_id),
                                                       key=lambda item: (item.objective_id, item.revision)))

    def save(self, user_id, run_id, objective_id, body):
        with self.generations.outline_store._lock, self.generations._lock, self._lock:
            run = self.generations.get(user_id, run_id)
            key = (user_id, str(run_id), objective_id)
            history = self._rows.get(key, [])
            edit = _validate(run, objective_id, body, self.max_revisions_per_lesson, history)
            self._rows.setdefault(key, []).append(edit)
            return edit.model_copy(deep=True)

    def _copy(self, user_id, run_id, history, reused_ids):
        for item in history:
            if item.objective_id in reused_ids:
                copied = item.model_copy(update={"run_id": run_id, "copied_from_run_id": item.run_id,
                                                 "copied_from_revision": item.revision}, deep=True)
                self._rows.setdefault((user_id, str(run_id), item.objective_id), []).append(copied)


class PgGenerationEditStore:
    def __init__(self, generations, *, max_revisions_per_lesson=5):
        _limit(max_revisions_per_lesson)
        self.generations, self.max_revisions_per_lesson = generations, max_revisions_per_lesson

    @staticmethod
    def _history(conn, user_id, run_id):
        rows = conn.execute(
            "SELECT e.* FROM course_generation_lesson_edits e JOIN course_generation_runs g "
            "ON g.id=e.run_id AND g.user_id=e.user_id WHERE e.user_id=%s AND e.run_id=%s "
            "ORDER BY e.objective_id,e.revision LIMIT 150", (user_id, str(run_id)),
        ).fetchall()
        return [GenerationLessonEdit(
            run_id=row["run_id"], objective_id=row["objective_id"], revision=row["revision"],
            output=LessonDraft.model_validate(row["output"]), created_at=row["created_at"].isoformat(),
            copied_from_run_id=row["copied_from_run_id"], copied_from_revision=row["copied_from_revision"],
        ) for row in rows]

    def list(self, user_id, run_id):
        self.generations.get(user_id, run_id)
        with self.generations._connection() as conn:
            return LessonEditListResponse(items=self._history(conn, user_id, run_id))

    @staticmethod
    def _insert(conn, user_id, item):
        from psycopg.types.json import Jsonb

        conn.execute("INSERT INTO course_generation_lesson_edits(run_id,user_id,objective_id,revision,output,"
                     "created_at,copied_from_run_id,copied_from_revision) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
                     (str(item.run_id), user_id, item.objective_id, item.revision,
                      Jsonb(item.output.model_dump(mode="json")), item.created_at,
                      str(item.copied_from_run_id) if item.copied_from_run_id else None, item.copied_from_revision))

    def save(self, user_id, run_id, objective_id, body):
        g = self.generations
        with g._connection() as conn:
            g.outline_store._owner(conn, user_id)
            candidate = g._decode(g._row(conn, user_id, run_id))
            g._approved(conn, user_id, candidate, lock=True)
            run = g._decode(g._row(conn, user_id, run_id, lock=True))
            history = [item for item in self._history(conn, user_id, run_id) if item.objective_id == objective_id]
            item = _validate(run, objective_id, body, self.max_revisions_per_lesson, history)
            self._insert(conn, user_id, item)
            return item

    def _copy(self, conn, user_id, run_id, history, reused_ids):
        for item in history:
            if item.objective_id in reused_ids:
                self._insert(conn, user_id, item.model_copy(update={
                    "run_id": run_id, "copied_from_run_id": item.run_id, "copied_from_revision": item.revision,
                }))
