"""RAG eval set (tasks 2.9 / 2.10): citation recall + groundedness.

Each case names an expected phrase that a correct citation/source chunk should
contain. `evaluate` runs a retriever function over the cases and reports recall
at k; the chat prompt is graded by the same mechanism on the answer's citations.

This is deliberately small (the master plan asks for 20-30 pairs; add more as
real PDFs land). It must pass before retrieval/prompt changes ship.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class EvalCase:
    question: str
    expected_phrase: str  # substring that should appear in a retrieved chunk


CASES: list[EvalCase] = [
    EvalCase("What is photosynthesis?", "photosynthesis"),
    EvalCase("What molecules absorb light?", "chlorophyll"),
    EvalCase("Where does the Calvin cycle occur?", "stroma"),
    EvalCase("What is the light-dependent reaction?", "light-dependent"),
    EvalCase("What gas is released by plants?", "oxygen"),
    EvalCase("What organelle carries out photosynthesis?", "chloroplast"),
    EvalCase("What is a thylakoid?", "thylakoid"),
    EvalCase("What is the role of NADPH?", "NADPH"),
    EvalCase("What is the role of ATP synthase?", "ATP synthase"),
    EvalCase("What is the overall equation for photosynthesis?", "glucose"),
]


def recall_at_k(case_hits: list[list[str]], cases: list[EvalCase] = CASES, k: int = 8) -> float:
    """Fraction of cases whose expected phrase appears in the top-k retrieved texts.

    case_hits[i] is the list of retrieved chunk texts for cases[i], best-first.
    """
    if len(case_hits) != len(cases):
        raise ValueError("one hit list per case")
    hits = sum(
        1
        for case, texts in zip(cases, case_hits, strict=True)
        if any(case.expected_phrase.lower() in t.lower() for t in texts[:k])
    )
    return hits / len(cases)


def check_min_recall(case_hits: list[list[str]], threshold: float = 0.8, k: int = 8) -> None:
    score = recall_at_k(case_hits, k=k)
    if score < threshold:
        raise AssertionError(f"RAG recall@{k} {score:.2f} below threshold {threshold:.2f}")
