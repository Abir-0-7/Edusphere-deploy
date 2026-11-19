"""C01: novice, experienced, skipped, editable preferences and isolation."""

import json
import uuid
from unittest.mock import MagicMock

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.main import app, learner_profiles
from app.privacy import PrivacyStore

client = TestClient(app)
PROFILE = {
    "goal_kind": "career",
    "goal": "Become a developer",
    "familiarity": "new",
    "weekly_minutes": 180,
    "deadline": None,
    "language": "en",
    "role_variant": "auto",
    "explanation_depth": "standard",
    "pace": "standard",
    "accessibility": {"reduced_motion": False, "larger_text": False, "text_alternative": True},
}
ANSWERS = [
    {"question_id": "expression-v1", "choice_id": "b"},
    {"question_id": "loop-v1", "choice_id": "a"},
    {"question_id": "function-v1", "choice_id": "c"},
]


@pytest.fixture()
def headers():
    return {"Authorization": f"Bearer profile-test-{uuid.uuid4()}"}


def submit(headers, answers=None, action="complete"):
    return client.post(
        "/api/learner-profile/diagnostic",
        headers=headers,
        json={
            "version": "python-foundations-v1",
            "action": action,
            "answers": ANSWERS if answers is None else answers,
        },
    )


@pytest.mark.parametrize(
    "path,method,body",
    [
        ("/api/learner-profile", "get", None),
        ("/api/learner-profile", "put", PROFILE),
        ("/api/learner-profile/diagnostic", "get", None),
        (
            "/api/learner-profile/diagnostic",
            "post",
            {"version": "python-foundations-v1", "action": "skip", "answers": []},
        ),
    ],
)
def test_all_profile_routes_require_auth(path, method, body):
    response = client.request(method, path, **({"json": body} if body else {}))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_novice_starts_unknown_and_can_skip_then_edit_reload(headers):
    assert client.get("/api/learner-profile", headers=headers).json() == {"profile": None}
    response = client.put("/api/learner-profile", headers=headers, json=PROFILE)
    assert response.status_code == 200
    profile = response.json()["profile"]
    assert profile["diagnostic"]["status"] == "not_started"
    assert {skill["state"] for skill in profile["diagnostic"]["skills"]} == {"unknown"}
    skipped = submit(headers, answers=[], action="skip")
    assert skipped.status_code == 200
    diagnostic = skipped.json()["profile"]["diagnostic"]
    assert diagnostic["status"] == "skipped" and diagnostic["completed_at"] is None
    edited = {
        **PROFILE,
        "goal_kind": "academic",
        "goal": " Pass my exam ",
        "weekly_minutes": 90,
        "deadline": "2027-02-28",
        "language": "bn",
        "accessibility": {"reduced_motion": True, "larger_text": True, "text_alternative": True},
    }
    saved = client.put("/api/learner-profile", headers=headers, json=edited).json()["profile"]
    assert saved["goal"] == "Pass my exam" and saved["diagnostic"] == diagnostic
    assert saved["language"] == "bn" and saved["deadline"] == "2027-02-28"
    assert saved["accessibility"]["larger_text"] is True
    assert client.get("/api/learner-profile", headers=headers).json()["profile"] == saved


def test_experience_is_not_mastery_and_partial_check_keeps_unknown(headers):
    response = client.put("/api/learner-profile", headers=headers, json={**PROFILE, "familiarity": "experienced"})
    assert all(s["state"] == "unknown" for s in response.json()["profile"]["diagnostic"]["skills"])
    result = submit(headers, [ANSWERS[0], {"question_id": "loop-v1", "choice_id": "c"}])
    assert result.status_code == 200
    summary = result.json()["profile"]["diagnostic"]
    assert summary["status"] == "completed" and summary["completed_at"]
    assert [s["state"] for s in summary["skills"]] == ["developing", "needs_practice", "unknown"]
    full = submit(headers).json()["profile"]
    assert {s["state"] for s in full["diagnostic"]["skills"]} == {"developing"}
    assert not {"mastery", "xp", "readiness", "prerequisites"}.intersection(full)
    saved = client.put("/api/learner-profile", headers=headers, json=PROFILE).json()["profile"]
    assert saved["diagnostic"] == full["diagnostic"]


def test_account_isolation_and_definition_has_no_keys(headers):
    client.put("/api/learner-profile", headers=headers, json=PROFILE)
    other = {"Authorization": f"Bearer other-{uuid.uuid4()}"}
    assert client.get("/api/learner-profile", headers=other).json() == {"profile": None}
    assert submit(other).status_code == 404
    definition = client.get("/api/learner-profile/diagnostic", headers=headers)
    assert definition.status_code == 200
    assert len(definition.json()["questions"]) == 3
    assert not any(key in json.dumps(definition.json()) for key in ["correct", "answer_key", "expected"])


def test_browser_can_save_profile_using_configured_origin():
    response = client.options(
        "/api/learner-profile",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


@pytest.mark.parametrize(
    "field,value",
    [
        ("goal", " "),
        ("goal", "x" * 201),
        ("goal_kind", "other"),
        ("familiarity", "mastered"),
        ("weekly_minutes", 0),
        ("weekly_minutes", 10081),
        ("weekly_minutes", True),
        ("weekly_minutes", "60"),
        ("deadline", "2027-02-30"),
        ("deadline", "2027-2-01"),
        ("deadline", 1735689600),
        ("language", "made-up"),
        ("user_id", "victim"),
        ("mastery", 1),
        ("accessibility", {"reduced_motion": "false", "larger_text": False, "text_alternative": True}),
    ],
)
def test_malformed_preferences_rejected_without_writing(headers, field, value):
    response = client.put("/api/learner-profile", headers=headers, json={**PROFILE, field: value})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_input"
    assert client.get("/api/learner-profile", headers=headers).json() == {"profile": None}


@pytest.mark.parametrize(
    "body",
    [
        {"version": "stale", "action": "skip", "answers": []},
        {"version": "python-foundations-v1", "action": "complete", "answers": []},
        {"version": "python-foundations-v1", "action": "skip", "answers": ANSWERS},
        {"version": "python-foundations-v1", "action": "complete", "answers": [ANSWERS[0], ANSWERS[0]]},
        {
            "version": "python-foundations-v1",
            "action": "complete",
            "answers": [{"question_id": "bad", "choice_id": "a"}],
        },
        {
            "version": "python-foundations-v1",
            "action": "complete",
            "answers": [{"question_id": "loop-v1", "choice_id": "bad"}],
        },
        {"version": "python-foundations-v1", "action": "complete", "answers": ANSWERS, "score": 100},
    ],
)
def test_invalid_diagnostic_cannot_replace_saved_state(headers, body):
    original = client.put("/api/learner-profile", headers=headers, json=PROFILE).json()["profile"]
    response = client.post("/api/learner-profile/diagnostic", headers=headers, json=body)
    assert response.status_code == 400
    assert client.get("/api/learner-profile", headers=headers).json()["profile"] == original


def test_profile_store_outage_returns_explicit_retryable_error(headers, monkeypatch):
    def unavailable(*args):
        raise psycopg.OperationalError("private connection details")

    monkeypatch.setattr(learner_profiles, "save", unavailable)
    response = client.put("/api/learner-profile", headers=headers, json=PROFILE)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "internal"
    assert "private connection" not in response.text
    assert client.get("/api/learner-profile", headers=headers).json() == {"profile": None}


def test_export_includes_owner_scoped_profile():
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchone.return_value = None
    cursor.fetchall.return_value = []
    connection = MagicMock()
    connection.cursor.return_value = cursor
    store = PrivacyStore.__new__(PrivacyStore)
    store._conn = connection
    data = store.export_user_data("only-this-user")
    query = next(c for c in cursor.execute.call_args_list if "FROM learner_profiles WHERE" in c.args[0])
    assert query.args[1] == ("only-this-user",)
    assert "WHERE user_id = %s" in query.args[0]
    assert data["tables"]["learner_profiles"] == []
