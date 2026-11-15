"""Tests for token rewards, the early-exit penalty and readiness (tasks 3.2, 3.3, 3.6)."""

from datetime import UTC, datetime, timedelta

from app.study.readiness import ReadinessInputs, breakdown, readiness_score
from app.study.tokens import (
    MAX_TOKENS_PER_SESSION,
    MIN_CREDIT_SECONDS,
    FocusTiming,
    clamp_elapsed,
    settle,
    tokens_for,
)

NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


class TestTokens:
    def test_completed_pomodoro_pays_by_planned_minutes(self) -> None:
        # 25 minutes * 2 tokens/min = 50
        assert tokens_for(FocusTiming(planned_seconds=1500, elapsed_seconds=1500, completed=True)) == 50

    def test_short_exit_earns_nothing(self) -> None:
        timing = FocusTiming(planned_seconds=1500, elapsed_seconds=MIN_CREDIT_SECONDS - 1, completed=False)
        assert tokens_for(timing) == 0

    def test_early_exit_earns_prorated_share_not_full(self) -> None:
        full = tokens_for(FocusTiming(planned_seconds=1500, elapsed_seconds=1500, completed=True))
        early = tokens_for(FocusTiming(planned_seconds=1500, elapsed_seconds=600, completed=False))
        assert 0 < early < full
        assert early == 20  # 10 minutes * 2

    def test_never_negative_and_capped(self) -> None:
        assert tokens_for(FocusTiming(planned_seconds=1500, elapsed_seconds=-999, completed=False)) >= 0
        huge = FocusTiming(planned_seconds=99999, elapsed_seconds=99999, completed=True)
        assert tokens_for(huge) == MAX_TOKENS_PER_SESSION

    def test_client_cannot_overreport_duration(self) -> None:
        # A 25-minute session claiming 10 hours is credited at most planned + grace.
        assert clamp_elapsed(1500, 36000) == 1500 + 120

    def test_settle_completes_when_past_expected_end(self) -> None:
        started = NOW - timedelta(minutes=26)
        status, actual, tokens = settle(
            planned_seconds=1500, started_at=started, now=NOW, expected_end_at=NOW - timedelta(minutes=1)
        )
        assert status == "completed"
        assert actual == 1560
        assert tokens > 0

    def test_settle_abandons_early_and_penalises_softly(self) -> None:
        started = NOW - timedelta(minutes=5)
        status, actual, tokens = settle(
            planned_seconds=1500, started_at=started, now=NOW, expected_end_at=NOW + timedelta(minutes=20)
        )
        assert status == "abandoned"
        assert actual == 300
        assert tokens == 10  # prorated, never negative

    def test_settle_immediate_exit_is_zero(self) -> None:
        started = NOW - timedelta(seconds=10)
        _, _, tokens = settle(
            planned_seconds=1500, started_at=started, now=NOW, expected_end_at=NOW + timedelta(minutes=25)
        )
        assert tokens == 0


class TestReadiness:
    def test_empty_account_scores_only_neutral_retention(self) -> None:
        # coverage 0, retention neutral 0.5, activity 0 -> 17.5 -> 18
        score = readiness_score(
            ReadinessInputs(
                chapters_total=0,
                chapters_summarised=0,
                reviews_due_recent=0,
                reviews_passed_recent=0,
                focus_minutes_last_7d=0,
            )
        )
        assert score == 18

    def test_perfect_week_is_100(self) -> None:
        inputs = ReadinessInputs(
            chapters_total=5,
            chapters_summarised=5,
            reviews_due_recent=10,
            reviews_passed_recent=10,
            focus_minutes_last_7d=210,
        )
        assert readiness_score(inputs) == 100

    def test_components_are_weighted_as_documented(self) -> None:
        # Only coverage perfect: 0.45*100 + 0.35*50 (neutral) = 62.5; Python
        # rounds halves to even, so 62. The doc pins the formula, not the tie.
        inputs = ReadinessInputs(
            chapters_total=2,
            chapters_summarised=2,
            reviews_due_recent=0,
            reviews_passed_recent=0,
            focus_minutes_last_7d=0,
        )
        assert readiness_score(inputs) == 62

    def test_monotonic(self) -> None:
        base = ReadinessInputs(4, 1, 4, 2, 30)
        faster = ReadinessInputs(4, 3, 4, 4, 120)
        assert readiness_score(faster) >= readiness_score(base)

    def test_breakdown_returns_components(self) -> None:
        b = breakdown(ReadinessInputs(4, 2, 4, 3, 105))
        assert set(b) == {"score", "coverage", "retention", "activity"}
        assert b["coverage"] == 0.5
        assert b["retention"] == 0.75
        assert b["activity"] == 0.5
        assert isinstance(b["score"], int)