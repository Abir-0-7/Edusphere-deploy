"""Exercise the recommendation policy against committed course and review records."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.courses.catalog import python_foundations, pytorch_fundamentals
from app.learners.contracts import LearnerDiagnosticRequest
from app.learners.diagnostic import assess
from app.learners.recommendations import recommend
from app.main import app, course_store, learner_profiles
from tests.test_learner_profiles import PROFILE

PROFILE_PATH = "/api/learner-profile"
RECOMMEND = f"{PROFILE_PATH}/recommendations"
TRACK = f"{PROFILE_PATH}/track-plan"
CATALOG = "/api/courses"
client = TestClient(app)


@pytest.fixture
def owner():
    user_id = str(uuid4())
    headers = {"Authorization": f"Bearer learner-c02-{user_id}"}
    assert client.put(PROFILE_PATH, headers=headers, json={**PROFILE, "familiarity": "experienced"}).status_code == 200
    return headers


def request_plan(headers, minutes=20):
    result = client.post(RECOMMEND, headers=headers, json={"available_minutes": minutes})
    assert result.status_code == 200, result.text
    return result.json()


def enroll(headers):
    response = client.post(f"{CATALOG}/python-foundations/enroll", headers=headers, json={})
    assert response.status_code == 200, response.text
    return response.json()


def attempt(headers, session, exercise_id, answer):
    response = client.post(
        f"/api/course-enrollments/{session['id']}/attempts",
        headers=headers,
        json={"id": str(uuid4()), "revision": session["revision"], "exercise_id": exercise_id, "answer": answer},
    )
    assert response.status_code == 200, response.text
    return response.json()


def refresh(headers, session):
    response = client.get(f"/api/course-enrollments/{session['id']}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def answer_for(exercise_id):
    return next(item.answer for item in python_foundations().exercises if item.id == exercise_id)


def test_bootstrap_is_private_and_respects_time_and_prerequisites(owner):
    assert client.post(RECOMMEND, json={}).status_code == 401
    stranger = {"Authorization": "Bearer unrelated-c02-learner"}
    assert request_plan(stranger)["next_action"]["kind"] == "set_goal"
    assert client.post(RECOMMEND, headers=owner, json={"mastery": 100}).status_code == 400
    assert client.post(RECOMMEND, headers=owner, json={"available_minutes": True}).status_code == 400
    options = client.get(f"{TRACK}/options", headers=owner).json()
    if options["current_track_id"] != "developer":
        preview = client.post(f"{TRACK}/preview", headers=owner, json={"target_track_id": "developer"}).json()
        applied = client.post(
            f"{TRACK}/apply",
            headers=owner,
            json={
                "target_track_id": "developer",
                "expected_revision": preview["expected_revision"],
                "preview_id": preview["preview_id"],
            },
        )
        assert applied.status_code == 200, applied.text
    plan = request_plan(owner)
    assert plan["track_id"] == "developer"
    assert plan["next_action"]["href"] == "/courses/python-foundations"
    assert any(
        item["course_slug"] == "pytorch-fundamentals" and "Python Foundations" in item["reason"]
        for item in plan["blocked"]
    )
    assert all(item["state"] == "unknown" for item in plan["mastery"])
    assert request_plan(owner, minutes=2)["next_action"] is None


def test_recommendation_snapshot_is_written_with_policy_and_plan_revision(owner):
    from app.main import recommendation_snapshot_store

    result = request_plan(owner)
    user_id = owner["Authorization"].removeprefix("Bearer ")
    stored = recommendation_snapshot_store._latest[user_id]
    assert result["policy_version"] == "career-next-action-v1"
    assert stored.model_dump(mode="json") == result
    assert result["plan_revision"] == 0


def test_practice_independent_checkpoint_and_scheduled_reviews(owner):
    session = enroll(owner)
    practice_id = session["lesson"]["practice"][0]["id"]
    passed_practice = attempt(owner, session, practice_id, answer_for(practice_id))
    assert passed_practice["correct"] and not passed_practice["independent"]
    plan = request_plan(owner)
    assert plan["next_action"]["kind"] == "transfer"
    assert all(item["state"] != "demonstrated" for item in plan["mastery"])
    session = refresh(owner, session)
    checkpoint_id = session["lesson"]["checkpoint"]["id"]
    assert attempt(owner, session, checkpoint_id, answer_for(checkpoint_id))["independent"]
    plan = request_plan(owner)
    proven = [item for item in plan["mastery"] if item["state"] == "demonstrated"]
    assert [item["objective_id"] for item in proven] == ["py-values-objective"]
    assert proven[0]["release_id"] == session["release_id"]
    assert proven[0]["evidence"] == "independent_checkpoint"
    assert plan["next_action"]["kind"] == "review" and plan["due_reviews"] == 1
    assert request_plan({"Authorization": "Bearer stranger-after-review"})["due_reviews"] == 0


def test_misconceptions_and_bridge_choose_the_next_action(owner):
    session = enroll(owner)
    checkpoint_id = session["lesson"]["checkpoint"]["id"]
    for _ in range(2):
        assert not attempt(owner, session, checkpoint_id, -12345)["correct"]
        session = refresh(owner, session)
    plan = request_plan(owner, minutes=5)
    assert plan["next_action"]["kind"] == "remediate"
    assert plan["mastery"][0]["state"] == "needs_practice"
    assert plan["mastery"][0]["evidence"] == "committed_attempt"
    assert session["remediation"]["step"] == "bridge"


def test_optional_diagnostic_is_separate_from_mastery(owner):
    user_id = owner["Authorization"].removeprefix("Bearer ")
    profile = learner_profiles.get(user_id)
    signal = assess(
        LearnerDiagnosticRequest(
            version="python-foundations-v1",
            action="complete",
            answers=[{"question_id": "expression-v1", "choice_id": "b"}],
        )
    )
    course = course_store.get_release("python-foundations", user_id)
    result = recommend(profile.model_copy(update={"diagnostic": signal}), [course], [], set(), {}, 0)
    assert result.mastery[0].starting_signal == "developing"
    assert result.mastery[0].state == "unknown"
    assert result.mastery[0].evidence == "diagnostic"


def test_profile_diagnostic_does_not_satisfy_course_prerequisite(owner):
    user_id = owner["Authorization"].removeprefix("Bearer ")
    profile = learner_profiles.get(user_id)
    signal = assess(
        LearnerDiagnosticRequest(
            version="python-foundations-v1",
            action="complete",
            answers=[
                {"question_id": "expression-v1", "choice_id": "b"},
                {"question_id": "loop-v1", "choice_id": "a"},
                {"question_id": "function-v1", "choice_id": "c"},
            ],
        )
    )
    courses = [python_foundations(), pytorch_fundamentals()]
    result = recommend(
        profile.model_copy(update={"diagnostic": signal}),
        courses,
        [],
        set(),
        {},
        0,
        track_id="developer",
    )

    assert result.next_action is not None
    assert result.next_action.href == "/courses/python-foundations"
    assert any(item.course_slug == "pytorch-fundamentals" for item in result.blocked)
    assert all(item.state != "demonstrated" for item in result.mastery)
