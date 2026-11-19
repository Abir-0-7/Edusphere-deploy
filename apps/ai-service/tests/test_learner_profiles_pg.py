"""Learner profile persistence on a disposable, migrated PostgreSQL database.

Set STUDYVAULT_TEST_DATABASE_URL to run this integration test.
The test creates and deletes only its two generated users.
"""

import os
from datetime import date
from uuid import uuid4

import psycopg
import pytest

from app.learners.contracts import LearnerDiagnosticRequest, LearnerProfileInput
from app.learners.diagnostic import assess
from app.learners.store import PgLearnerStore
from app.privacy import PrivacyStore


def test_profile_persists_with_diagnostic_export_and_account_cascade():
    url = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("STUDYVAULT_TEST_DATABASE_URL not set")

    owner, other = (str(uuid4()) for _ in range(2))
    profile = LearnerProfileInput.model_validate(
        {
            "goal_kind": "academic",
            "goal": "Prepare for a Python exam",
            "familiarity": "experienced",
            "weekly_minutes": 120,
            "deadline": "2027-02-28",
            "language": "bn",
            "accessibility": {"reduced_motion": True, "larger_text": False, "text_alternative": True},
        }
    )
    result = assess(
        LearnerDiagnosticRequest.model_validate(
            {
                "version": "python-foundations-v1",
                "action": "complete",
                "answers": [{"question_id": "expression-v1", "choice_id": "b"}],
            }
        )
    )
    store = PgLearnerStore(url)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO users (id, clerk_id, email) VALUES (%s, %s, %s)",
            [(user_id, f"test-profile-{user_id}", f"{user_id}@example.test") for user_id in (owner, other)],
        )
    try:
        assert store.get(owner) is None
        assert store.save(owner, profile).deadline == date(2027, 2, 28)
        assert store.get(other) is None
        assert store.diagnose(other, result) is None
        store.save(other, profile.model_copy(update={"goal": "Unrelated goal"}))

        diagnosed = store.diagnose(owner, result)
        assert diagnosed is not None
        assert diagnosed.diagnostic == result
        updated = store.save(owner, profile.model_copy(update={"weekly_minutes": 90, "deadline": None}))
        assert updated.weekly_minutes == 90 and updated.deadline is None
        assert updated.diagnostic == result
        assert PgLearnerStore(url).get(owner) == updated

        privacy = PrivacyStore(url)
        try:
            exported = privacy.export_user_data(owner)["tables"]["learner_profiles"]
            assert len(exported) == 1
            assert exported[0]["user_id"] == owner
            assert exported[0]["goal"] == profile.goal
            assert exported[0]["diagnostic"] == result.model_dump(mode="json")
            assert privacy.delete_user_data(owner) == 1
        finally:
            privacy.close()

        assert store.get(owner) is None
        remaining = store.get(other)
        assert remaining is not None and remaining.goal == "Unrelated goal"
    finally:
        with psycopg.connect(url) as conn:
            conn.execute("DELETE FROM users WHERE id IN (%s, %s)", (owner, other))
