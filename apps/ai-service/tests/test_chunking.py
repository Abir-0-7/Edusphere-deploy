from app.rag.chunking import ChunkInput, chunk_markdown


def test_chunk_sizes_and_overlap() -> None:
    text = " ".join(f"word{i}" for i in range(2000))
    chunks = chunk_markdown([ChunkInput(text=text)], max_chars=300, overlap_chars=50)
    assert len(chunks) > 1
    for c in chunks:
        assert len(c.content) <= 300
    # consecutive chunks share overlapping words at the seam
    for prev, nxt in zip(chunks, chunks[1:], strict=False):
        tail_words = prev.content[-60:].split()
        assert any(w in nxt.content for w in tail_words), (prev.content[-60:], nxt.content[:60])


def test_metadata_propagated() -> None:
    chunks = chunk_markdown([ChunkInput(text="a b c", page=7, chapter_title="Intro", chapter_ordinal=2)])
    assert chunks[0].page == 7
    assert chunks[0].chapter_title == "Intro"
    assert chunks[0].chapter_ordinal == 2


def test_ordinals_are_sequential_and_content_preserved() -> None:
    text = "para one\n\npara two\n\npara three"
    chunks = chunk_markdown([ChunkInput(text=text)], max_chars=50, overlap_chars=10)
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))
    assert "".join(c.content for c in chunks).replace(" ", "").startswith("paraone")


def test_invalid_params_raise() -> None:
    try:
        chunk_markdown([ChunkInput(text="x")], max_chars=10, overlap_chars=10)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")


# --- Task 2.7: page/chapter-aware inputs -----------------------------------


def test_chunk_inputs_tag_page_and_chapter() -> None:
    from app.rag.chunking import ChapterSpan, chunk_inputs_from_pages

    chapters = [ChapterSpan("Cells", 1, 1, 2), ChapterSpan("Energy", 2, 3, 4)]
    inputs = chunk_inputs_from_pages([(1, "a"), (2, "b"), (3, "c"), (5, "orphan")], chapters)
    assert [(i.page, i.chapter_title, i.chapter_ordinal) for i in inputs] == [
        (1, "Cells", 1),
        (2, "Cells", 1),
        (3, "Energy", 2),
        (5, None, None),
    ]


def test_chunks_never_span_pages() -> None:
    from app.rag.chunking import ChapterSpan, chunk_inputs_from_pages

    long_page = "Sentence about mitochondria. " * 200
    inputs = chunk_inputs_from_pages([(1, long_page), (2, "short page two")], [ChapterSpan("Bio", 1, 1, 2)])
    chunks = chunk_markdown(inputs, max_chars=400, overlap_chars=50)
    assert {c.page for c in chunks} == {1, 2}
    assert all("short page two" not in c.content for c in chunks if c.page == 1)
    assert all(len(c.content) <= 400 for c in chunks)
    assert all(c.chapter_title == "Bio" for c in chunks)
