"""Viva transport distinguishes authentication, source readiness and provider failures."""

import json
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.documents.store import ChapterRecord, ChunkRecord
from app.llm.router import AllProvidersFailed

QUESTIONS = {"questions": [{"question": "What does albedo measure?", "expected_points": ["Surface reflectivity"]}]}
GRADE = {"score": 4, "feedback": "Clear explanation.", "covered": ["Reflectivity"], "missed": []}


def material(*, text=True):
    owner = f"viva-{uuid4()}"
    document = main.documents.create(user_id=owner, filename="albedo.pdf", mime_type="application/pdf", size_bytes=1)
    chapter_id, chunk_id = str(uuid4()), str(uuid4())
    chapter = ChapterRecord(chapter_id, document.id, owner, "Albedo", 1, 1, 1)
    chunks = [ChunkRecord(chunk_id, document.id, owner, chapter_id, "Albedo measures surface reflectivity.", 1, 1)]
    main.documents.replace_structure(document.id, [chapter], chunks if text else [])
    return owner, document


def test_viva_question_endpoint_uses_owned_document_material_and_returns_wire_questions(monkeypatch):
    owner, document = material()
    router = Mock()
    router.complete.return_value = json.dumps(QUESTIONS)
    monkeypatch.setattr(main, "llm_router", router)
    client = TestClient(main.app)
    endpoint = f"/api/documents/{document.id}/viva-questions"
    assert client.post(endpoint).status_code == 401
    assert client.post(endpoint, headers={"Authorization": "Bearer intruder"}).status_code == 404
    router.complete.assert_not_called()
    response = client.post(endpoint, headers={"Authorization": f"Bearer {owner}"})
    assert response.status_code == 200 and response.json() == QUESTIONS["questions"]
    messages = router.complete.call_args.args[0]
    assert "Albedo measures surface reflectivity." in messages[1]["content"]
    assert "untrusted" in messages[0]["content"].lower()


def test_viva_missing_text_is_readiness_error_without_provider_call(monkeypatch):
    owner, document = material(text=False)
    router = Mock()
    monkeypatch.setattr(main, "llm_router", router)
    response = TestClient(main.app).post(
        f"/api/documents/{document.id}/viva-questions", headers={"Authorization": f"Bearer {owner}"},
    )
    assert response.status_code == 409
    assert "text is not ready" in response.json()["error"]["message"]
    router.complete.assert_not_called()


@pytest.mark.parametrize("failure, expected", [(AllProvidersFailed("secret provider URL"), 503), ("bad JSON", 502)])
def test_viva_questions_provider_errors_are_safe_and_do_not_blame_chapters(monkeypatch, failure, expected):
    owner, document = material()
    router = Mock()
    if isinstance(failure, Exception):
        router.complete.side_effect = failure
    else:
        router.complete.return_value = failure
    monkeypatch.setattr(main, "llm_router", router)
    response = TestClient(main.app).post(
        f"/api/documents/{document.id}/viva-questions", headers={"Authorization": f"Bearer {owner}"},
    )
    assert response.status_code == expected
    assert "chapters" not in response.text and "secret" not in response.text


@pytest.mark.parametrize("payload, expected", [
    (GRADE, 200), ({"error": "provider failed"}, 502),
    ({**GRADE, "score": True}, 502), ({**GRADE, "feedback": " "}, 502),
])
def test_viva_grading_accepts_only_valid_results_and_never_invents_zero_score(monkeypatch, payload, expected):
    router = Mock()
    router.complete.return_value = json.dumps(payload)
    monkeypatch.setattr(main, "llm_router", router)
    response = TestClient(main.app).post("/api/viva-grade", headers={"Authorization": "Bearer viva-grader"}, json={
        "question": "What is albedo?", "expected_points": ["Reflectivity"], "answer": "Surface reflectivity",
    })
    assert response.status_code == expected
    if expected == 200:
        assert response.json() == GRADE
    else:
        assert "score" not in response.json() and "could not be evaluated" in response.text


@pytest.mark.parametrize("answer", [None, 3, [], " ", "x" * 4001])
def test_viva_rejects_invalid_answer_before_provider_call(monkeypatch, answer):
    router = Mock()
    monkeypatch.setattr(main, "llm_router", router)
    response = TestClient(main.app).post("/api/viva-grade", headers={"Authorization": "Bearer viva-bounded"}, json={
        "question": "What is albedo?", "answer": answer, "expected_points": ["Reflectivity"],
    })
    assert response.status_code == 400
    router.complete.assert_not_called()
