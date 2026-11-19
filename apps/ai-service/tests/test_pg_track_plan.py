"""Track plan persistence, ownership and account cascade on migrated Postgres."""

import os
from uuid import uuid4

import psycopg
import pytest

from app.errors import InvalidInput
from app.learners.contracts import LearnerProfileInput
from app.learners.recommendations import PgRecommendationStore, recommend
from app.learners.store import PgLearnerStore
from app.learners.track_routes import TrackProgress, preview_plan
from app.learners.track_store import PgTrackPlanStore
from app.privacy import PrivacyStore


@pytest.fixture(autouse=True)
def disable_server_prepared_statements_on_embedded_postgres(monkeypatch):
    """PGlite multiplexes connections onto one backend prepared-statement namespace."""
    connect = psycopg.connect

    def connect_without_server_prepares(*args, **kwargs):
        kwargs.setdefault("prepare_threshold", None)
        return connect(*args, **kwargs)

    monkeypatch.setattr(psycopg, "connect", connect_without_server_prepares)


def test_postgres_track_revisions_preferences_export_and_cascade(monkeypatch):
    url = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("STUDYVAULT_TEST_DATABASE_URL not set")
    owner, other = (str(uuid4()) for _ in range(2))
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO users (id,clerk_id,email) VALUES (%s,%s,%s)",
            [(user, f"track-test-{user}", f"{user}@example.test") for user in (owner, other)],
        )
    try:
        profiles = PgLearnerStore(url)
        profile = profiles.save(
            owner,
            LearnerProfileInput.model_validate(
                {
                    "goal_kind": "career",
                    "goal": "Learn Python development",
                    "familiarity": "new",
                    "weekly_minutes": 80,
                    "deadline": None,
                    "language": "en",
                    "accessibility": {"reduced_motion": False, "larger_text": True, "text_alternative": True},
                    "role_variant": "developer",
                    "explanation_depth": "guided",
                    "pace": "short_sessions",
                }
            ),
        )
        assert PgLearnerStore(url).get(owner) == profile
        assert profiles.get(other) is None
        plans = PgTrackPlanStore(url)
        first = preview_plan(owner, "career", None, "developer", TrackProgress())
        saved = plans.apply(owner, first)
        assert PgTrackPlanStore(url).get(owner) == saved
        assert plans.get(other) is None
        with pytest.raises(InvalidInput, match="changed"):
            plans.apply(owner, first)
        second = preview_plan(owner, "career", saved, "analyst", TrackProgress())
        changed = plans.apply(owner, second)
        assert [item.revision for item in plans.history(owner, None)] == [2, 1]
        assert plans.history(owner, before_revision=2) == [saved]
        assert plans.history(other, None) == []
        snapshot = recommend(profile, [], [], set(), {}, 0)
        PgRecommendationStore(url).save(owner, snapshot)
        privacy = PrivacyStore(url)
        try:
            # Other, concurrently developed platform tables may not be migrated
            # in this disposable C04-only PostgreSQL fixture.
            monkeypatch.setattr(
                "app.privacy._OWNED_TABLES",
                [
                    ("learner_profiles", [
                        "user_id", "goal_kind", "goal", "familiarity", "weekly_minutes", "deadline", "language",
                        "accessibility", "role_variant", "explanation_depth", "pace", "diagnostic", "created_at",
                        "updated_at",
                    ]),
                    ("learner_track_plan_revisions", [
                        "id", "revision", "track_id", "required_course_slugs", "required_objective_ids",
                        "objective_mapping", "created_at",
                    ]),
                    ("learner_recommendation_snapshots", ["snapshot", "updated_at"]),
                ],
            )
            exported = privacy.export_user_data(owner)["tables"]
            assert exported["learner_profiles"][0]["role_variant"] == "developer"
            assert {item["revision"] for item in exported["learner_track_plan_revisions"]} == {1, 2}
            assert exported["learner_recommendation_snapshots"][0]["snapshot"]["policy_version"]
            assert privacy.export_user_data(other)["tables"]["learner_track_plan_revisions"] == []
            assert changed.track_id == "analyst"
            assert privacy.delete_user_data(owner) == 1
        finally:
            privacy.close()
        assert plans.history(owner, None) == []
        with psycopg.connect(url) as conn:
            assert (
                conn.execute("SELECT 1 FROM learner_recommendation_snapshots WHERE user_id=%s", (owner,)).fetchone()
                is None
            )
            assert conn.execute("SELECT 1 FROM users WHERE id=%s", (other,)).fetchone() == (1,)
    finally:
        with psycopg.connect(url) as conn:
            conn.execute("DELETE FROM users WHERE id IN (%s,%s)", (owner, other))
