"""Study tokens, focus rewards and the early-exit penalty (tasks 3.2, 3.3).

All of this runs server-side: the client may report how long it *thinks* it
studied, but the server re-derives the elapsed time from the stored
`started_at` / `expected_end_at` timestamps and never trusts a claimed value.

Rules (documented so the UI can explain them):
  * a completed session pays `rate * minutes`, rounded down, capped at
    `MAX_TOKENS_PER_SESSION`;
  * leaving early pays the prorated share of the session actually spent, but
    only past `MIN_CREDIT_SECONDS` — before that the reward is 0;
  * the balance never goes negative: the ledger is append-only and rewards are
    never deducted; an early exit simply earns less.
"""

from dataclasses import dataclass
from datetime import datetime

MAX_TOKENS_PER_SESSION = 120
MIN_CREDIT_SECONDS = 60
TOKENS_PER_MINUTE = 2
# A session may not be credited for more than this beyond its planned length.
OVERRUN_GRACE_SECONDS = 120


@dataclass(frozen=True)
class FocusTiming:
    planned_seconds: int
    elapsed_seconds: int
    completed: bool


def elapsed_seconds(started_at: datetime, now: datetime) -> int:
    """Seconds actually spent, floored at 0 (clock skew must not go negative)."""
    return max(0, int((now - started_at).total_seconds()))


def clamp_elapsed(planned_seconds: int, reported_seconds: int) -> int:
    """Ignore a client-reported duration longer than the planned session + grace.

    This is the anti-cheat guard: a client claiming 10 hours for a 25-minute
    pomodoro is credited at most `planned + grace`.
    """
    ceiling = planned_seconds + OVERRUN_GRACE_SECONDS
    return max(0, min(reported_seconds, ceiling))


def tokens_for(timing: FocusTiming) -> int:
    """Reward for a session. Completed sessions pay for the planned length;
    early exits pay for the time actually spent (never negative)."""
    credited = timing.planned_seconds if timing.completed else timing.elapsed_seconds
    if credited < MIN_CREDIT_SECONDS:
        return 0
    earned = (credited // 60) * TOKENS_PER_MINUTE
    return max(0, min(earned, MAX_TOKENS_PER_SESSION))


def settle(
    *, planned_seconds: int, started_at: datetime, now: datetime, expected_end_at: datetime
) -> tuple[str, int, int]:
    """Decide the outcome of a session that is being closed.

    Returns (status, actual_seconds, tokens). The caller persists these and
    appends the ledger row; the ledger's unique (reason, ref_id) makes a
    duplicate settle a no-op.
    """
    spent = elapsed_seconds(started_at, now)
    completed = now >= expected_end_at
    actual = clamp_elapsed(planned_seconds, spent)
    tokens = tokens_for(FocusTiming(planned_seconds=planned_seconds, elapsed_seconds=actual, completed=completed))
    return ("completed" if completed else "abandoned"), actual, tokens
