"""SM-2 spaced repetition (task 2.12). Server-authoritative; mirrors
packages/db/src/sm2.ts so web and ai-service agree on the algorithm.

quality: 0-5. 0/1/2 = fail (again), 3 = hard, 4 = good, 5 = easy.
"""

from dataclasses import dataclass


@dataclass
class Sm2State:
    ease_factor: float = 2.5
    interval_days: int = 0
    repetitions: int = 0


def review(state: Sm2State, quality: int) -> Sm2State:
    if not isinstance(quality, int) or not 0 <= quality <= 5:
        raise ValueError("quality must be an integer 0..5")

    ef, interval, reps = state.ease_factor, state.interval_days, state.repetitions
    if quality < 3:
        reps = 0
        interval = 0
    else:
        if reps == 0:
            interval = 1
        elif reps == 1:
            interval = 6
        else:
            interval = round(interval * ef)
        reps += 1

    ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    ef = max(ef, 1.3)
    return Sm2State(ease_factor=round(ef, 2), interval_days=interval, repetitions=reps)


def due_date(today, interval_days: int) -> str:
    """ISO YYYY-MM-DD for the next review."""
    from datetime import timedelta

    return (today + timedelta(days=interval_days)).isoformat()
