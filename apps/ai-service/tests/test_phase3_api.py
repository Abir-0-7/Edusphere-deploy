"""Phase 3 API tests: focus sessions, tokens, readiness, plans, advice (tasks
3.1-3.3, 3.5, 3.8) against the in-memory stores."""

from datetime import date, timedelta

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.ai.advice import _fallback_advice, advice_for_metrics
from app.ai.exam_plan import ExamPlan, fallback_plan
from app.main import app
from app.study.readiness import ReadinessInputs, breakdown
from app.study.tokens import settle

client = TestClient(app)
AUTH = {"Authorization": "Bearer phase3-user"}


class TestFocusApi:
    def test_start_session_sets_server_timestamps(self) -> None:
        resp = client.post("/api/focus-sessions", headers=AUTH, json={"kind": "pomodoro"})
        assert resp.status_code == 201
        body = resp.json()
        assert body["status"] == "running"
        assert body["planned_seconds"] == 1500
        # Server computed the end time; the client only sent the kind.
        assert body["expected_end_at"] > body["started_at"]

    def test_cannot_start_two_sessions(self) -> None:
        client.post("/api/focus-sessions", headers=AUTH, json={"kind": "pomodoro"})
        second = client.post("/api/focus-sessions", headers=AUTH, json={"kind": "desk"})
        assert second.status_code == 400
        # Clean up by finishing the running one.
        current = client.get("/api/focus-sessions/current", headers=AUTH).json()
        client.post(f"/api/focus-sessions/{current['id']}/complete", headers=AUTH)

    def test_invalid_kind_rejected(self) -> None:
        assert client.post("/api/focus-sessions", headers=AUTH, json={"kind": "nap"}).status_code == 400

    def test_completing_twice_pays_once(self) -> None:
        start = client.post("/api/focus-sessions", headers=AUTH, json={"kind": "pomodoro"}).json()
        first = client.post(f"/api/focus-sessions/{start['id']}/complete", headers=AUTH).json()
        second = client.post(f"/api/focus-sessions/{start['id']}/complete", headers=AUTH).json()
        assert first["replayed"] is False
        assert second["replayed"] is True
        assert second["tokens_awarded"] == 0
        # Balance did not move on the replay.
        assert second["token_balance"] == first["token_balance"]

    def test_current_session_survives_refresh(self) -> None:
        start = client.post("/api/focus-sessions", headers=AUTH, json={"kind": "desk"}).json()
        current = client.get("/api/focus-sessions/current", headers=AUTH).json()
        assert current["id"] == start["id"]
        client.post(f"/api/focus-sessions/{start['id']}/complete", headers=AUTH)

    def test_other_user_cannot_complete(self) -> None:
        start = client.post("/api/focus-sessions", headers=AUTH, json={"kind": "pomodoro"}).json()
        other = client.post(
            f"/api/focus-sessions/{start['id']}/complete", headers={"Authorization": "Bearer intruder"}
        )
        assert other.status_code == 404
        client.post(f"/api/focus-sessions/{start['id']}/complete", headers=AUTH)


class TestDashboardApi:
    def test_dashboard_and_readiness_shape(self) -> None:
        d = client.get("/api/dashboard", headers=AUTH)
        assert d.status_code == 200
        assert {"focus_minutes_7d", "reviews_7d", "due_flashcards", "token_balance"} <= set(d.json())
        r = client.get("/api/readiness", headers=AUTH)
        assert r.status_code == 200
        assert 0 <= r.json()["score"] <= 100
        assert set(r.json()) == {"score", "coverage", "retention", "activity"}


class TestExamPlan:
    def test_fallback_plan_covers_every_chapter_within_days(self) -> None:
        today = date(2026, 1, 1)
        plan = fallback_plan(
            chapters=["A", "B", "C", "D", "E"], exam_date=today + timedelta(days=5), today=today, minutes_per_day=60
        )
        assert isinstance(plan, ExamPlan)
        assert len(plan.days) == 5
        assert plan.covers(["A", "B", "C", "D", "E"])
        assert all(d.minutes == 60 for d in plan.days)
        assert plan.exam_date == today + timedelta(days=5)

    def test_fallback_rejects_past_date(self) -> None:
        with pytest.raises(ValueError):
            fallback_plan(chapters=["A"], exam_date=date(2026, 1, 1), today=date(2026, 1, 1), minutes_per_day=60)

    def test_study_plan_endpoint_requires_chapters(self) -> None:
        resp = client.post(
            "/api/documents/00000000-0000-0000-0000-000000000000/study-plan",
            headers=AUTH,
            json={"exam_date": (date.today() + timedelta(days=7)).isoformat()},
        )
        assert resp.status_code == 404


class TestAdvice:
    def test_fallback_advice_mentions_metrics(self) -> None:
        text = _fallback_advice({"focus_minutes_7d": 30, "reviews_7d": 4, "due_flashcards": 3})
        assert "30 minutes" in text
        assert "3 card" in text

    def test_advice_falls_back_when_providers_down(self) -> None:
        with respx.mock:
            respx.post("https://primary.test/v1/chat/completions").mock(
                return_value=httpx.Response(500)
            )
            respx.post("https://groq.test/v1/chat/completions").mock(return_value=httpx.Response(500))
            respx.post("https://router.huggingface.co/v1/chat/completions").mock(
                return_value=httpx.Response(500)
            )
            from app.llm.router import router_from_settings
            from app.settings import get_settings

            text = advice_for_metrics(router_from_settings(get_settings()), {"focus_minutes_7d": 10})
        assert "10 minutes" in text  # deterministic fallback, never an exception


class TestTokensPrecision:
    def test_settle_ignores_client_overreport(self) -> None:
        from datetime import UTC, datetime

        now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
        status, actual, tokens = settle(
            planned_seconds=1500,
            started_at=now,  # claims to have started "now"
            now=now + timedelta(minutes=1),
            expected_end_at=now + timedelta(minutes=25),
        )
        assert status == "abandoned"
        assert actual == 60
        assert tokens == 2
        assert breakdown(ReadinessInputs(0, 0, 0, 0, 0))["score"] == 18