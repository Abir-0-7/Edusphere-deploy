"""Summaries, flashcards and the SM-2 review path (tasks 2.5, 2.6, 2.11, 2.12).

Exercised through the HTTP API against the in-memory stores with the LLM
mocked via respx.
"""

import httpx
import respx
from fastapi.testclient import TestClient

from app.main import app, worker
from tests.test_pdf import make_text_pdf

client = TestClient(app)
AUTH = {"Authorization": "Bearer api-user"}

LLM_OUTLINE = '{"chapters": [{"title": "Photosynthesis", "start_page": 1, "end_page": 2, "summary": "light"}]}'
LLM_SUMMARY = "Photosynthesis converts light into chemical energy."
LLM_CARDS = '{"cards": [{"front": "What is photosynthesis?", "back": "Converting light to chemical energy."}]}'


def _structured_document() -> tuple[str, str]:
    """Upload, run the pipeline, return (document_id, chapter_id)."""
    resp = client.post("/api/parse-pdf", headers=AUTH, files={"file": ("bio.pdf", make_text_pdf(2), "application/pdf")})
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]
    with respx.mock:
        respx.post("https://primary.test/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": LLM_OUTLINE}}]})
        )
        while worker.process_one():
            pass
    doc_id = client.get(f"/api/jobs/{job_id}", headers=AUTH).json()["result"]["document_id"]
    chapters = client.get(f"/api/documents/{doc_id}/chapters", headers=AUTH).json()
    return doc_id, chapters[0]["id"]


def test_summary_streams_and_is_saved_then_reloaded() -> None:
    _, chapter_id = _structured_document()
    with respx.mock:
        respx.post("https://primary.test/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": LLM_SUMMARY}}]})
        )
        resp = client.post(f"/api/chapters/{chapter_id}/summary", headers=AUTH, json={"level": "eli5"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert '"token"' in resp.text
    assert '"done": true' in resp.text or '"done":true' in resp.text

    # Reload returns the saved text without calling the LLM.
    saved = client.get(f"/api/chapters/{chapter_id}/summary", headers=AUTH, params={"level": "eli5"})
    assert saved.status_code == 200
    assert saved.json()["content"] == LLM_SUMMARY


def test_summary_levels_are_independent() -> None:
    _, chapter_id = _structured_document()
    with respx.mock:
        respx.post("https://primary.test/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": "standard text"}}]})
        )
        client.post(f"/api/chapters/{chapter_id}/summary", headers=AUTH, json={"level": "standard"})
        respx.post("https://primary.test/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": "eli5 text"}}]})
        )
        client.post(f"/api/chapters/{chapter_id}/summary", headers=AUTH, json={"level": "eli5"})

    standard = client.get(f"/api/chapters/{chapter_id}/summary", headers=AUTH, params={"level": "standard"})
    eli5 = client.get(f"/api/chapters/{chapter_id}/summary", headers=AUTH, params={"level": "eli5"})
    assert standard.json()["content"] == "standard text"
    assert eli5.json()["content"] == "eli5 text"


def test_invalid_level_rejected() -> None:
    _, chapter_id = _structured_document()
    resp = client.post(f"/api/chapters/{chapter_id}/summary", headers=AUTH, json={"level": "poetry"})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_input"


def test_other_users_cannot_read_summary() -> None:
    _, chapter_id = _structured_document()
    with respx.mock:
        respx.post("https://primary.test/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": "secret"}}]})
        )
        client.post(f"/api/chapters/{chapter_id}/summary", headers=AUTH, json={"level": "standard"})
    resp = client.get(
        f"/api/chapters/{chapter_id}/summary",
        headers={"Authorization": "Bearer intruder"},
        params={"level": "standard"},
    )
    assert resp.status_code == 404


def test_flashcards_generate_and_link_to_chunks() -> None:
    doc_id, _ = _structured_document()
    resp = client.post(f"/api/documents/{doc_id}/flashcards", headers=AUTH)
    assert resp.status_code == 202
    with respx.mock:
        respx.post("https://primary.test/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": LLM_CARDS}}]})
        )
        while worker.process_one():
            pass
    cards = client.get(f"/api/documents/{doc_id}/flashcards", headers=AUTH).json()
    assert len(cards) == 1
    assert cards[0]["front"] == "What is photosynthesis?"
    assert cards[0]["source_chunk_id"] is not None


def test_review_updates_sm2_server_side_and_is_grade_validated() -> None:
    doc_id, _ = _structured_document()
    client.post(f"/api/documents/{doc_id}/flashcards", headers=AUTH)
    with respx.mock:
        respx.post("https://primary.test/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": LLM_CARDS}}]})
        )
        while worker.process_one():
            pass
    card = client.get(f"/api/documents/{doc_id}/flashcards", headers=AUTH).json()[0]

    queue = client.get("/api/flashcards/review-queue", headers=AUTH)
    assert queue.status_code == 200
    assert any(c["id"] == card["id"] for c in queue.json())

    first = client.post(f"/api/flashcards/{card['id']}/review", headers=AUTH, json={"grade": 4})
    assert first.status_code == 200
    body = first.json()
    assert body["interval_days"] == 1
    assert body["repetitions"] == 1

    second = client.post(f"/api/flashcards/{card['id']}/review", headers=AUTH, json={"grade": 4})
    assert second.json()["interval_days"] == 6

    # A lapse resets.
    lapse = client.post(f"/api/flashcards/{card['id']}/review", headers=AUTH, json={"grade": 1})
    assert lapse.json()["repetitions"] == 0
    assert lapse.json()["interval_days"] == 0

    assert client.post(f"/api/flashcards/{card['id']}/review", headers=AUTH, json={"grade": 9}).status_code == 400
    assert client.post(f"/api/flashcards/{card['id']}/review", headers=AUTH, json={"grade": "x"}).status_code == 400
    other = client.post(
        f"/api/flashcards/{card['id']}/review",
        headers={"Authorization": "Bearer intruder"},
        json={"grade": 4},
    )
    assert other.status_code == 404
