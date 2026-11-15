import pytest

from app.rag.rrf import reciprocal_rank_fusion


def test_rrf_fuses_two_rankings() -> None:
    fused = reciprocal_rank_fusion([["a", "b", "c"], ["b", "d"]], k=60)
    ids = [doc_id for doc_id, _ in fused]
    # "b" is rank 2 in ranking 1 and rank 1 in ranking 2 -> top
    assert ids[0] == "b"
    assert ids[1] == "a"
    scores = dict(fused)
    assert scores["b"] == pytest.approx(1 / 62 + 1 / 61)
    assert scores["a"] == pytest.approx(1 / 61)
    assert scores["d"] == pytest.approx(1 / 62)


def test_rrf_dedupes_within_a_ranking() -> None:
    fused = reciprocal_rank_fusion([["a", "a", "b"]])
    assert dict(fused)["a"] > dict(fused)["b"]
    assert len(fused) == 2


def test_rrf_invalid_k() -> None:
    with pytest.raises(ValueError):
        reciprocal_rank_fusion([["a"]], k=0)
