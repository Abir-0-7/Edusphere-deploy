"""Reciprocal Rank Fusion (task 2.9). Pure function + unit tested."""

from collections.abc import Iterable


def reciprocal_rank_fusion(
    rankings: Iterable[Iterable[str]],
    k: int = 60,
) -> list[tuple[str, float]]:
    """Fuse multiple ranked id lists into one ranking by RRF score.

    score(d) = sum over rankings of 1 / (k + rank(d)), rank starting at 1.
    Ties break by first appearance order.
    """
    if k <= 0:
        raise ValueError("k must be positive")
    scores: dict[str, float] = {}
    first_seen: dict[str, int] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(dict.fromkeys(ranking), start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
            first_seen.setdefault(doc_id, len(first_seen))
    return sorted(scores.items(), key=lambda item: (-item[1], first_seen[item[0]]))
