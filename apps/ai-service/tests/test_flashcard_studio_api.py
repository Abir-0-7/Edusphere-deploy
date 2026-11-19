"""Credential-free end-to-end acceptance for the Flashcard Studio HTTP surface."""

from uuid import uuid4

from fastapi.testclient import TestClient

from app.documents.store import ChapterRecord, ChunkRecord
from app.flashcard_studio.service import STUDIO_JOB
from app.main import app, documents, job_store, llm_router, worker

client = TestClient(app)


def test_preview_requires_explicit_merge_and_reuses_scheduled_review(monkeypatch):
    owner = "flashcard-studio-api-owner"
    doc = documents.create(
        user_id=owner, filename="study.pdf", mime_type="application/pdf", size_bytes=100,
    )
    chapter = ChapterRecord(str(uuid4()), doc.id, owner, "Plants", 0, 1, 1)
    chunk = ChunkRecord(
        str(uuid4()), doc.id, owner, chapter.id,
        "Plants use chlorophyll to absorb light energy.", 1, 0,
    )
    documents.replace_structure(doc.id, [chapter], [chunk])
    monkeypatch.setattr(
        llm_router,
        "complete",
        lambda _messages: (
            '{"cards":[{"source_chunk_id":"' + chunk.id
            + '","source_quote":"chlorophyll to absorb light energy",'
            '"front":"What absorbs light energy?","back":"Chlorophyll."}]}'
        ),
    )
    accepted: list[bool] = []
    monkeypatch.setattr(llm_router, "accept_cache_candidate", lambda: accepted.append(True))
    headers = {"Authorization": f"Bearer {owner}"}
    path = f"/api/documents/{doc.id}/flashcard-studio"
    request = {
        "chapter_ids": [chapter.id], "topic": None, "language": "en",
        "difficulty": "basic", "count": 3,
    }

    queued = client.post(f"{path}/drafts", headers=headers, json=request)
    assert queued.status_code == 202, queued.text
    ids = queued.json()
    job = job_store.get(ids["job_id"], owner)
    assert job is not None and job.kind == STUDIO_JOB
    result = worker.handlers[STUDIO_JOB](job.payload)
    job_store.mark_running(job.id)
    assert job_store.mark_done(job.id, result)
    assert accepted == [True]

    preview = client.get(f"{path}/drafts/{ids['draft_id']}", headers=headers)
    assert preview.status_code == 200, preview.text
    card = preview.json()["cards"][0]
    assert card["source_chunk_id"] == chunk.id
    assert card["source_quote"] == "chlorophyll to absorb light energy"
    assert documents.list_flashcards(doc.id, owner) == []
    other_owner = client.get(
        f"{path}/drafts/{ids['draft_id']}", headers={"Authorization": "Bearer another-user"}
    )
    assert other_owner.status_code == 404

    merged = client.post(
        f"{path}/drafts/{ids['draft_id']}/merge",
        headers=headers,
        json={"card_ids": [card["id"]], "deck_name": "Chapter 1"},
    )
    assert merged.status_code == 200, merged.text
    assert merged.json()["added_count"] == 1
    saved = documents.get_flashcard_for_user(card["id"], owner)
    assert saved is not None and saved["repetitions"] == 0
    cards = client.get(f"/api/documents/{doc.id}/flashcards?deck_id={merged.json()['deck_id']}", headers=headers)
    assert cards.status_code == 200 and [row["id"] for row in cards.json()] == [card["id"]]

    review = client.post(
        f"/api/flashcards/{card['id']}/review", headers=headers, json={"grade": 4, "review_id": str(uuid4())},
    )
    assert review.status_code == 200, review.text
    assert review.json()["repetitions"] == 1
    after_review = client.get(f"/api/documents/{doc.id}/flashcards?deck_id={merged.json()['deck_id']}", headers=headers)
    assert after_review.json()[0]["repetitions"] == 1
    retry = client.post(
        f"{path}/drafts/{ids['draft_id']}/merge",
        headers=headers,
        json={"card_ids": [card["id"]], "deck_name": "Chapter 1"},
    )
    assert retry.status_code == 200 and retry.json() == merged.json()
    changed = client.post(
        f"{path}/drafts/{ids['draft_id']}/merge",
        headers=headers,
        json={"card_ids": [card["id"]]},
    )
    assert changed.status_code == 409

    monkeypatch.setattr(llm_router, "complete", lambda _messages: "The passage states that chlorophyll absorbs light.")
    explained = client.get(f"/api/flashcards/{card['id']}/explain", headers=headers)
    assert explained.status_code == 200, explained.text
    assert explained.json() == {
        "card_id": card["id"],
        "explanation": "The passage states that chlorophyll absorbs light.",
        "source_quote": "chlorophyll to absorb light energy",
        "page": 1,
        "available": True,
        "source_excerpt": "chlorophyll to absorb light energy",
    }

    doc.chunks[0].content = "The source has been replaced."
    stale_preview = client.get(f"{path}/drafts/{ids['draft_id']}", headers=headers)
    assert stale_preview.status_code == 409
    stale_explanation = client.get(f"/api/flashcards/{card['id']}/explain", headers=headers)
    assert stale_explanation.status_code == 409
