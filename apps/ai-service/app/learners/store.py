"""Owner-scoped, bounded profiles. Postgres errors never fall back to memory."""

from datetime import UTC, datetime
from threading import Lock
from typing import Protocol

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.learners.contracts import LearnerDiagnosticSummary, LearnerProfile, LearnerProfileInput
from app.learners.diagnostic import unknown_diagnostic


class LearnerStore(Protocol):
    def get(self, user_id: str) -> LearnerProfile | None: ...
    def save(self, user_id: str, body: LearnerProfileInput) -> LearnerProfile: ...
    def diagnose(self, user_id: str, result: LearnerDiagnosticSummary) -> LearnerProfile | None: ...


class MemoryLearnerStore:
    """Explicit local/test mode only. No global or browser profile cache."""

    def __init__(self) -> None:
        self._profiles: dict[str, LearnerProfile] = {}
        self._lock = Lock()

    def get(self, user_id: str) -> LearnerProfile | None:
        with self._lock:
            row = self._profiles.get(user_id)
            return row.model_copy(deep=True) if row else None

    def save(self, user_id: str, body: LearnerProfileInput) -> LearnerProfile:
        with self._lock:
            old = self._profiles.get(user_id)
            row = LearnerProfile(
                **body.model_dump(),
                diagnostic=old.diagnostic if old else unknown_diagnostic(),
                updated_at=datetime.now(UTC),
            )
            self._profiles[user_id] = row
            return row.model_copy(deep=True)

    def diagnose(self, user_id: str, result: LearnerDiagnosticSummary) -> LearnerProfile | None:
        with self._lock:
            row = self._profiles.get(user_id)
            if row is None:
                return None
            row = row.model_copy(update={"diagnostic": result, "updated_at": datetime.now(UTC)}, deep=True)
            self._profiles[user_id] = row
            return row.model_copy(deep=True)


_COLUMNS = (
    "goal_kind, goal, familiarity, weekly_minutes, deadline, language, accessibility, role_variant, "
    "explanation_depth, pace, diagnostic, updated_at"
)


class PgLearnerStore:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def resolve_user(self, clerk_id: str) -> str:
        """Resolve Clerk subjects even when another Postgres store failed at boot."""
        with psycopg.connect(self.database_url) as conn:
            row = conn.execute("SELECT id FROM users WHERE clerk_id = %s", (clerk_id,)).fetchone()
            if row is not None:
                return str(row[0])
            row = conn.execute(
                "INSERT INTO users (clerk_id, email) VALUES (%s, %s) "
                "ON CONFLICT (clerk_id) DO UPDATE SET email = EXCLUDED.email RETURNING id",
                (clerk_id, f"{clerk_id}@clerk-pending.invalid"),
            ).fetchone()
            return str(row[0])

    def get(self, user_id: str) -> LearnerProfile | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            row = conn.execute(f"SELECT {_COLUMNS} FROM learner_profiles WHERE user_id = %s", (user_id,)).fetchone()
        return LearnerProfile.model_validate(row) if row else None

    def save(self, user_id: str, body: LearnerProfileInput) -> LearnerProfile:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            row = conn.execute(
                f"""INSERT INTO learner_profiles
                    (user_id, goal_kind, goal, familiarity, weekly_minutes, deadline, language,
                     accessibility, role_variant, explanation_depth, pace, diagnostic)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET
                    goal_kind = EXCLUDED.goal_kind, goal = EXCLUDED.goal, familiarity = EXCLUDED.familiarity,
                    weekly_minutes = EXCLUDED.weekly_minutes, deadline = EXCLUDED.deadline,
                    language = EXCLUDED.language, accessibility = EXCLUDED.accessibility,
                    role_variant = EXCLUDED.role_variant, explanation_depth = EXCLUDED.explanation_depth,
                    pace = EXCLUDED.pace, updated_at = now()
                    RETURNING {_COLUMNS}""",
                (
                    user_id,
                    body.goal_kind,
                    body.goal,
                    body.familiarity,
                    body.weekly_minutes,
                    body.deadline.isoformat() if body.deadline else None,
                    body.language,
                    Jsonb(body.accessibility.model_dump()),
                    body.role_variant,
                    body.explanation_depth,
                    body.pace,
                    Jsonb(unknown_diagnostic().model_dump(mode="json")),
                ),
            ).fetchone()
        return LearnerProfile.model_validate(row)

    def diagnose(self, user_id: str, result: LearnerDiagnosticSummary) -> LearnerProfile | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            row = conn.execute(
                f"UPDATE learner_profiles SET diagnostic = %s, updated_at = now() "
                f"WHERE user_id = %s RETURNING {_COLUMNS}",
                (Jsonb(result.model_dump(mode="json")), user_id),
            ).fetchone()
        return LearnerProfile.model_validate(row) if row else None
