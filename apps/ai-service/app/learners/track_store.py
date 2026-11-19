"""Append-only learner plan revisions; an update never touches course state."""

import copy
import threading
from collections.abc import Callable
from typing import Protocol
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.errors import InvalidInput, NotFound
from app.learners.track_contracts import SavedTrackPlan, TrackChangePreview, now_utc

RefreshPreview = Callable[[], TrackChangePreview]

HISTORY_PAGE_SIZE = 20
_PLAN_FIELDS = "revision,track_id,required_course_slugs,required_objective_ids,objective_mapping,created_at"


class TrackPlanStore(Protocol):
    def get(self, user_id: str) -> SavedTrackPlan | None: ...
    def history(self, user_id: str, before_revision: int | None) -> list[SavedTrackPlan]: ...
    def apply(
        self, user_id: str, preview: TrackChangePreview, refresh: RefreshPreview | None = None
    ) -> SavedTrackPlan: ...


class MemoryTrackPlanStore:
    """Development/test store; production uses the cascading Postgres table."""

    def __init__(self):
        self._rows: dict[str, list[SavedTrackPlan]] = {}
        self._lock = threading.RLock()

    def get(self, user_id: str) -> SavedTrackPlan | None:
        with self._lock:
            history = self._rows.get(user_id, [])
            return history[-1].model_copy(deep=True) if history else None

    def history(self, user_id: str, before_revision: int | None) -> list[SavedTrackPlan]:
        with self._lock:
            rows = self._rows.get(user_id, [])
            end = len(rows) if before_revision is None else min(len(rows), before_revision - 1)
            return copy.deepcopy(rows[max(0, end - HISTORY_PAGE_SIZE) : end][::-1])

    def apply(
        self, user_id: str, preview: TrackChangePreview, refresh: RefreshPreview | None = None
    ) -> SavedTrackPlan:
        with self._lock:
            history = self._rows.setdefault(user_id, [])
            revision = history[-1].revision if history else 0
            if revision != preview.expected_revision:
                raise InvalidInput("Learning plan changed; review the new preview before applying", status_code=409)
            if refresh is not None and refresh().preview_id != preview.preview_id:
                raise InvalidInput("Learning progress changed; review the new preview before applying", status_code=409)
            plan = SavedTrackPlan(
                revision=revision + 1,
                track_id=preview.target_track_id,
                required_course_slugs=preview.required_course_slugs,
                required_objective_ids=preview.required_objective_ids,
                objective_mapping=preview.objective_mapping,
                created_at=now_utc(),
            )
            history.append(plan)
            return plan.model_copy(deep=True)


class PgTrackPlanStore:
    """Persist immutable owner snapshots; relies on an additive reviewed migration."""

    def __init__(self, database_url: str):
        self.database_url = database_url

    def _connect(self):
        return psycopg.connect(self.database_url, row_factory=dict_row, connect_timeout=5)

    def get(self, user_id: str) -> SavedTrackPlan | None:
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT {_PLAN_FIELDS} FROM learner_track_plan_revisions "
                "WHERE user_id=%s ORDER BY revision DESC LIMIT 1",
                (user_id,),
            ).fetchone()
        return SavedTrackPlan.model_validate(row) if row else None

    def history(self, user_id: str, before_revision: int | None) -> list[SavedTrackPlan]:
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT {_PLAN_FIELDS} FROM learner_track_plan_revisions "
                "WHERE user_id=%s AND (%s::integer IS NULL OR revision < %s::integer) "
                "ORDER BY revision DESC LIMIT %s",
                (user_id, before_revision, before_revision, HISTORY_PAGE_SIZE),
            ).fetchall()
        return [SavedTrackPlan.model_validate(row) for row in rows]

    def apply(
        self, user_id: str, preview: TrackChangePreview, refresh: RefreshPreview | None = None
    ) -> SavedTrackPlan:
        with self._connect() as conn, conn.transaction():
            user = conn.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,)).fetchone()
            if user is None:
                raise NotFound("Learner account not found")
            row = conn.execute(
                "SELECT revision FROM learner_track_plan_revisions WHERE user_id=%s ORDER BY revision DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            current = row["revision"] if row else 0
            if current != preview.expected_revision:
                raise InvalidInput("Learning plan changed; review the new preview before applying", status_code=409)
            # Course attempts take the same owner row lock; refreshing evidence
            # after acquiring it preserves attempts committed before plan apply.
            if refresh is not None and refresh().preview_id != preview.preview_id:
                raise InvalidInput("Learning progress changed; review the new preview before applying", status_code=409)
            created_at = now_utc()
            row = conn.execute(
                "INSERT INTO learner_track_plan_revisions "
                "(id,user_id,revision,track_id,required_course_slugs,required_objective_ids,"
                "objective_mapping,created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
                f"RETURNING {_PLAN_FIELDS}",
                (
                    str(uuid4()),
                    user_id,
                    current + 1,
                    preview.target_track_id,
                    Jsonb(preview.required_course_slugs),
                    Jsonb(preview.required_objective_ids),
                    Jsonb([item.model_dump(mode="json") for item in preview.objective_mapping]),
                    created_at,
                ),
            ).fetchone()
        return SavedTrackPlan.model_validate(row)
