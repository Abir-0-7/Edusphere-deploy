"""Data export and deletion (task 7.4, privacy hard rule).

Export returns every row the user owns as JSON — documents, chapters, chunks,
summaries, chat sessions, flashcards, reviews, focus sessions, study logs and
their token ledger — so the data is portable. Deletion removes the user row;
every owned table cascades (`ON DELETE CASCADE` in docs/schema.md), and the
Clerk `user.deleted` webhook already removes the account row.

Both paths are scoped by the internal users.id resolved from the Clerk subject;
no other user's data can be reached.
"""

import json
import logging
from typing import Any

logger = logging.getLogger("studyvault.privacy")

# Tables owned by a user, in dependency order (children first is not needed
# thanks to ON DELETE CASCADE, but ordering keeps the export readable).
_OWNED_TABLES = [
    (
        "documents",
        ["id", "filename", "mime_type", "size_bytes", "page_count", "status", "markdown", "created_at"],
    ),
    ("chapters", ["id", "document_id", "title", "ordinal", "start_page", "end_page", "created_at"]),
    ("chunks", ["id", "document_id", "chapter_id", "content", "page", "ordinal", "created_at"]),
    ("summaries", ["id", "chapter_id", "level", "content", "model", "updated_at"]),
    ("chat_sessions", ["id", "document_id", "messages", "updated_at"]),
    (
        "flashcards",
        [
            "id",
            "document_id",
            "chapter_id",
            "front",
            "back",
            "ease_factor",
            "interval_days",
            "repetitions",
            "due_date",
            "created_at",
        ],
    ),
    ("reviews", ["id", "flashcard_id", "grade", "reviewed_at"]),
    (
        "focus_sessions",
        [
            "id",
            "kind",
            "planned_seconds",
            "actual_seconds",
            "status",
            "started_at",
            "expected_end_at",
            "ended_at",
        ],
    ),
    ("study_logs", ["id", "kind", "payload", "occurred_at"]),
    ("study_plans", ["id", "document_id", "exam_date", "plan", "created_at"]),
    ("weekly_advice", ["id", "content", "model", "generated_at"]),
    ("courses", ["id", "slug", "user_id", "title", "created_at", "updated_at"]),
    (
        "course_releases",
        [
            "id", "course_id", "user_id", "version", "status", "visibility", "content", "content_hash",
            "created_at", "updated_at",
        ],
    ),
    (
        "course_enrollments",
        ["id", "user_id", "release_id", "document_id", "state", "revision", "status", "created_at", "updated_at"],
    ),
    ("course_attempts", ["id", "user_id", "enrollment_id", "exercise_id", "kind", "request", "result", "created_at"]),
    (
        "learner_profiles",
        [
            "user_id", "goal_kind", "goal", "familiarity", "weekly_minutes", "deadline", "language",
            "accessibility", "role_variant", "explanation_depth", "pace", "diagnostic", "created_at", "updated_at",
        ],
    ),
    (
        "learner_track_plan_revisions",
        [
            "id", "user_id", "revision", "track_id", "required_course_slugs", "required_objective_ids",
            "objective_mapping", "created_at",
        ],
    ),
    ("learner_recommendation_snapshots", ["user_id", "snapshot", "updated_at"]),
    ("token_ledger", ["id", "amount", "reason", "ref_id", "created_at"]),
    (
        "game_sessions",
        ["id", "user_id", "game_id", "snapshot", "status", "revision", "tokens_awarded", "created_at", "updated_at"],
    ),
    (
        "game_mission_progress",
        ["id", "user_id", "game_id", "mission_id", "unlocked_at", "completed_at", "xp_awarded", "achievements"],
    ),
    ("realtime_matchmaking", ["user_id", "match_id", "opponent_user_id", "created_at", "expires_at"]),
    ("realtime_event_limits", ["user_id", "minute", "count"]),
]

# Guild rows use explicit ownership columns rather than the standard
# ``user_id`` column. Keep this allow-list separate so the query builder below
# never accepts table or column names from a request.
_GUILD_TABLES = [
    (
        "study_guilds",
        ["id", "owner_user_id", "name", "invite_code", "weekly_goal_minutes", "created_at", "updated_at"],
        "owner_user_id = %s OR id IN (SELECT guild_id FROM study_guild_members WHERE user_id = %s)",
    ),
    ("study_guild_members", ["id", "guild_id", "user_id", "joined_at"], "user_id = %s"),
]


class PrivacyStore:
    def __init__(self, database_url: str) -> None:
        import psycopg

        self._conn = psycopg.connect(database_url, autocommit=True)

    def export_user_data(self, user_id: str) -> dict[str, Any]:
        with self._conn.cursor() as cur:
            cur.execute("SELECT id, clerk_id, email, created_at FROM users WHERE id = %s", (user_id,))
            account = cur.fetchone()
        data: dict[str, Any] = {
            "user_id": user_id,
            "account": dict(zip(("id", "clerk_id", "email", "created_at"), account, strict=True))
            if account
            else None,
            "tables": {},
        }
        for table, columns in _OWNED_TABLES:
            cols = ", ".join(columns)
            with self._conn.cursor() as cur:
                cur.execute(f"SELECT {cols} FROM {table} WHERE user_id = %s", (user_id,))
                rows = cur.fetchall()
            data["tables"][table] = [dict(zip(columns, row, strict=True)) for row in rows]
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id, opponent_user_id, state - 'cards', created_at, updated_at, expires_at "
                "FROM realtime_duels WHERE user_id = %s OR opponent_user_id = %s",
                (user_id, user_id),
            )
            rows = cur.fetchall()
        columns = ["id", "user_id", "opponent_user_id", "state", "created_at", "updated_at", "expires_at"]
        data["tables"]["realtime_duels"] = [dict(zip(columns, row, strict=True)) for row in rows]
        for table, columns, owner_clause in _GUILD_TABLES:
            cols = ", ".join(columns)
            with self._conn.cursor() as cur:
                params = (user_id, user_id) if table == "study_guilds" else (user_id,)
                cur.execute(f"SELECT {cols} FROM {table} WHERE {owner_clause}", params)
                rows = cur.fetchall()
            data["tables"][table] = [dict(zip(columns, row, strict=True)) for row in rows]
        # UUIDs and datetimes are not JSON-serialisable by default.
        return json.loads(json.dumps(data, default=str))

    def delete_user_data(self, user_id: str) -> int:
        """Delete the user row; owned tables cascade. Returns the user's id for
        logging. Called by the webhook handler or an explicit account-deletion
        request."""
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id = %s RETURNING clerk_id", (user_id,))
            row = cur.fetchone()
        if row is None:
            return 0
        logger.info("deleted user %s (clerk %s) and all owned rows", user_id, row[0])
        return 1

    def close(self) -> None:
        self._conn.close()
