"""Focus sessions, study log, token ledger and dashboard aggregates (phase 3).

Server-authoritative: the client sends the *planned* length and a kind; the
server sets `started_at` and `expected_end_at`, derives elapsed time itself and
awards tokens through the ledger (whose unique (reason, ref_id) makes a replayed
completion idempotent).
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

logger = logging.getLogger("studyvault.focus")

FOCUS_KINDS = {"pomodoro": 1500, "desk": 3000, "ultradian": 5400}


def _session_row(r: tuple) -> dict[str, Any]:
    (rid, kind, planned, actual, status, started, expected_end, ended) = r
    return {
        "id": str(rid),
        "kind": kind,
        "planned_seconds": planned,
        "actual_seconds": actual,
        "status": status,
        "started_at": started.isoformat(),
        "expected_end_at": expected_end.isoformat(),
        "ended_at": ended.isoformat() if ended else None,
    }


class PgStudyStore:
    def __init__(self, database_url: str) -> None:
        import psycopg

        self._conn = psycopg.connect(database_url, autocommit=True)

    def healthcheck(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute("SELECT 1")
            if cur.fetchone() != (1,):
                raise RuntimeError("study database health check returned an invalid result")

    # --- focus sessions -----------------------------------------------------
    def start_session(
        self, user_id: str, kind: str, planned_seconds: int, now: datetime | None = None
    ) -> dict[str, Any]:
        now = now or datetime.now(UTC)
        expected_end = now + timedelta(seconds=planned_seconds)
        with self._conn.cursor() as cur:
            cur.execute(
                "INSERT INTO focus_sessions (user_id, kind, planned_seconds, status, started_at, expected_end_at)"
                " VALUES (%s, %s, %s, 'running', %s, %s)"
                " RETURNING id, kind, planned_seconds, actual_seconds, status, started_at, expected_end_at, ended_at",
                (user_id, kind, planned_seconds, now, expected_end),
            )
            return _session_row(cur.fetchone())

    def get_session(self, session_id: str, user_id: str) -> dict[str, Any] | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, kind, planned_seconds, actual_seconds, status, started_at, expected_end_at, ended_at"
                " FROM focus_sessions WHERE id=%s AND user_id=%s",
                (session_id, user_id),
            )
            row = cur.fetchone()
        return _session_row(row) if row else None

    def running_session(self, user_id: str) -> dict[str, Any] | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, kind, planned_seconds, actual_seconds, status, started_at, expected_end_at, ended_at"
                " FROM focus_sessions WHERE user_id=%s AND status='running' ORDER BY started_at DESC LIMIT 1",
                (user_id,),
            )
            row = cur.fetchone()
        return _session_row(row) if row else None

    def close_session(
        self, session_id: str, *, status: str, actual_seconds: int, tokens: int, now: datetime | None = None
    ) -> None:
        now = now or datetime.now(UTC)
        with self._conn.transaction():
            with self._conn.cursor() as cur:
                cur.execute(
                    "UPDATE focus_sessions SET status=%s, actual_seconds=%s, ended_at=%s, updated_at=now()"
                    " WHERE id=%s",
                    (status, actual_seconds, now, session_id),
                )
                # Append-only ledger; the unique (reason, ref_id) makes a replay a no-op.
                cur.execute(
                    "INSERT INTO token_ledger (user_id, amount, reason, ref_id)"
                    " SELECT user_id, %s, 'focus', id FROM focus_sessions WHERE id=%s"
                    " ON CONFLICT (reason, ref_id) DO NOTHING",
                    (tokens, session_id),
                )
                cur.execute(
                    "INSERT INTO study_logs (user_id, kind, payload, occurred_at)"
                    " SELECT user_id, 'focus', jsonb_build_object('session_id', id, 'seconds', %s, 'tokens', %s), %s"
                    " FROM focus_sessions WHERE id=%s",
                    (actual_seconds, tokens, now, session_id),
                )

    def balance(self, user_id: str) -> int:
        with self._conn.cursor() as cur:
            cur.execute("SELECT COALESCE(SUM(amount), 0) FROM token_ledger WHERE user_id=%s", (user_id,))
            return int(cur.fetchone()[0])

    # --- dashboard aggregates (task 3.7) ------------------------------------
    def dashboard(self, user_id: str, now: datetime | None = None) -> dict[str, Any]:
        now = now or datetime.now(UTC)
        since = now - timedelta(days=7)
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT COALESCE(SUM(actual_seconds), 0) FROM focus_sessions"
                " WHERE user_id=%s AND started_at >= %s",
                (user_id, since),
            )
            focus_seconds = int(cur.fetchone()[0])
            cur.execute(
                "SELECT count(*) FROM reviews WHERE user_id=%s AND reviewed_at >= %s",
                (user_id, since),
            )
            reviews_7d = int(cur.fetchone()[0])
            cur.execute(
                "SELECT COALESCE(jsonb_object_agg(day, secs), '{}'::jsonb) FROM ("
                "  SELECT to_char(started_at, 'YYYY-MM-DD') AS day, SUM(actual_seconds)::int AS secs"
                "  FROM focus_sessions WHERE user_id=%s AND started_at >= %s GROUP BY 1"
                ") t",
                (user_id, since),
            )
            per_day = cur.fetchone()[0] or {}
            cur.execute(
                "SELECT count(*) FROM flashcards WHERE user_id=%s AND due_date <= %s",
                (user_id, now.date().isoformat()),
            )
            due_now = int(cur.fetchone()[0])
        return {
            "focus_minutes_7d": focus_seconds // 60,
            "focus_seconds_per_day": per_day,
            "reviews_7d": reviews_7d,
            "due_flashcards": due_now,
            "token_balance": self.balance(user_id),
        }

    def readiness_inputs(self, user_id: str, now: datetime | None = None) -> dict[str, int]:
        now = now or datetime.now(UTC)
        since = now - timedelta(days=7)
        with self._conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM chapters WHERE user_id=%s", (user_id,))
            chapters_total = int(cur.fetchone()[0])
            cur.execute(
                "SELECT count(DISTINCT s.chapter_id) FROM summaries s"
                " JOIN chapters c ON c.id = s.chapter_id WHERE c.user_id=%s",
                (user_id,),
            )
            summarised = int(cur.fetchone()[0])
            cur.execute(
                "SELECT count(*) FROM flashcards WHERE user_id=%s AND due_date <= %s AND due_date >= %s",
                (user_id, now.date().isoformat(), since.date().isoformat()),
            )
            recent_due = int(cur.fetchone()[0])
            cur.execute(
                "SELECT count(*) FROM reviews WHERE user_id=%s AND grade >= 3 AND reviewed_at >= %s",
                (user_id, since),
            )
            recent_passed = int(cur.fetchone()[0])
            cur.execute(
                "SELECT COALESCE(SUM(actual_seconds), 0) FROM focus_sessions"
                " WHERE user_id=%s AND started_at >= %s",
                (user_id, since),
            )
            focus_minutes = int(cur.fetchone()[0]) // 60
        return {
            "chapters_total": chapters_total,
            "chapters_summarised": summarised,
            "reviews_due_recent": recent_due,
            "reviews_passed_recent": recent_passed,
            "focus_minutes_last_7d": focus_minutes,
        }

    # --- weekly advice cache (task 3.8) ------------------------------------
    def get_weekly_advice(self, user_id: str) -> dict[str, Any] | None:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT content, model, generated_at, (generated_at > now() - interval '7 days')"
                " FROM weekly_advice WHERE user_id=%s",
                (user_id,),
            )
            row = cur.fetchone()
        if row is None or not row[3]:
            return None
        return {"content": row[0], "model": row[1], "generated_at": row[2].isoformat()}

    def save_weekly_advice(self, user_id: str, content: str, model: str | None) -> dict[str, Any]:
        with self._conn.cursor() as cur:
            cur.execute(
                "INSERT INTO weekly_advice (user_id, content, model) VALUES (%s, %s, %s)"
                " ON CONFLICT (user_id) DO UPDATE SET content=EXCLUDED.content,"
                " model=EXCLUDED.model, generated_at=now()"
                " RETURNING content, model, generated_at",
                (user_id, content, model),
            )
            row = cur.fetchone()
        return {"content": row[0], "model": row[1], "generated_at": row[2].isoformat()}


class InMemoryStudyStore:
    """Same surface for dev/tests (no psycopg)."""

    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, Any]] = {}
        self._ledger: dict[tuple[str, str], int] = {}
        self._reviews: list[dict[str, Any]] = []
        self._focus_seconds: dict[str, int] = {}
        self._advice: dict[str, dict[str, Any]] = {}

    def start_session(
        self, user_id: str, kind: str, planned_seconds: int, now: datetime | None = None
    ) -> dict[str, Any]:
        now = now or datetime.now(UTC)
        sid = str(uuid.uuid4())
        row = {
            "id": sid,
            "kind": kind,
            "planned_seconds": planned_seconds,
            "actual_seconds": 0,
            "status": "running",
            "started_at": now.isoformat(),
            "expected_end_at": (now + timedelta(seconds=planned_seconds)).isoformat(),
            "ended_at": None,
            "_user": user_id,
        }
        self._sessions[sid] = row
        return {k: v for k, v in row.items() if not k.startswith("_")}

    def get_session(self, session_id: str, user_id: str) -> dict[str, Any] | None:
        row = self._sessions.get(session_id)
        if row is None or row["_user"] != user_id:
            return None
        return {k: v for k, v in row.items() if not k.startswith("_")}

    def running_session(self, user_id: str) -> dict[str, Any] | None:
        for row in self._sessions.values():
            if row["_user"] == user_id and row["status"] == "running":
                return {k: v for k, v in row.items() if not k.startswith("_")}
        return None

    def close_session(
        self, session_id: str, *, status: str, actual_seconds: int, tokens: int, now: datetime | None = None
    ) -> None:
        row = self._sessions[session_id]
        row["status"] = status
        row["actual_seconds"] = actual_seconds
        row["ended_at"] = (now or datetime.now(UTC)).isoformat()
        if (row["_user"], session_id) not in self._ledger:
            self._ledger[(row["_user"], session_id)] = tokens
        self._focus_seconds[row["_user"]] = self._focus_seconds.get(row["_user"], 0) + actual_seconds

    def add_review(self, user_id: str, grade: int) -> None:
        self._reviews.append({"user_id": user_id, "grade": grade, "reviewed_at": datetime.now(UTC)})

    def balance(self, user_id: str) -> int:
        return sum(t for (uid, _), t in self._ledger.items() if uid == user_id)

    def dashboard(self, user_id: str, now: datetime | None = None) -> dict[str, Any]:
        return {
            "focus_minutes_7d": self._focus_seconds.get(user_id, 0) // 60,
            "focus_seconds_per_day": {},
            "reviews_7d": len([r for r in self._reviews if r["user_id"] == user_id]),
            "due_flashcards": 0,
            "token_balance": self.balance(user_id),
        }

    def readiness_inputs(self, user_id: str, now: datetime | None = None) -> dict[str, int]:
        return {
            "chapters_total": 0,
            "chapters_summarised": 0,
            "reviews_due_recent": 0,
            "reviews_passed_recent": 0,
            "focus_minutes_last_7d": self._focus_seconds.get(user_id, 0) // 60,
        }

    # --- weekly advice cache (task 3.8) ------------------------------------
    def get_weekly_advice(self, user_id: str) -> dict[str, Any] | None:
        row = self._advice.get(user_id)
        if row is None:
            return None
        if (datetime.now(UTC) - row["_at"]).days >= 7:
            return None
        return {k: v for k, v in row.items() if not k.startswith("_")}

    def save_weekly_advice(self, user_id: str, content: str, model: str | None) -> dict[str, Any]:
        row = {"content": content, "model": model, "generated_at": datetime.now(UTC).isoformat()}
        self._advice[user_id] = {**row, "_at": datetime.now(UTC)}
        return row
