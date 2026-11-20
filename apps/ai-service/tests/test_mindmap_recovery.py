"""Provider outages keep the existing source-derived concept map available."""

from unittest.mock import Mock

import pytest

from app.ai.mindmap import build, fallback
from app.documents.store import ChapterRecord, ChunkRecord
from app.errors import RateLimited
from app.llm.router import AllProvidersFailed


def source():
    chapter = ChapterRecord("chapter", "document", "owner", "Photosynthesis", 1, 1, 1)
    chunk = ChunkRecord("chunk", "document", "owner", chapter.id, "chlorophyll converts light energy", 1, 1)
    return [chapter], [chunk]


def test_provider_outage_returns_the_local_source_map():
    chapters, chunks = source()
    router = Mock()
    router.complete.side_effect = AllProvidersFailed("providers unavailable")

    result = build(router, chapters, chunks)

    assert result == fallback(chapters, chunks)
    assert any(node.label == "Photosynthesis" for node in result.nodes)
    assert any(node.label == "chlorophyll" for node in result.nodes)
    router.complete.assert_called_once()
    router.accept_cache_candidate.assert_not_called()


def test_provider_fallback_does_not_hide_admission_failures():
    chapters, chunks = source()
    router = Mock()
    router.complete.side_effect = RateLimited("Daily limit reached")

    with pytest.raises(RateLimited, match="Daily limit reached"):
        build(router, chapters, chunks)
