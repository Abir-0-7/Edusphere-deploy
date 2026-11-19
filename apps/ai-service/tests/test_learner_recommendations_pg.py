"""C02 recommendation snapshots use migrated, owner-cascading Postgres storage."""

import os
from uuid import uuid4

import psycopg
import pytest

from app.learners.recommendations import PgRecommendationStore, RecommendationResponse
from app.privacy import PrivacyStore


@pytest.fixture(autouse=True)
def disable_server_prepared_statements_on_embedded_postgres(monkeypatch):
    connect = psycopg.connect

    def connect_without_server_prepares(*args, **kwargs):
        kwargs.setdefault("prepare_threshold", None)
        return connect(*args, **kwargs)

    monkeypatch.setattr(psycopg, "connect", connect_without_server_prepares)


def test_persisted_snapshot_is_owner_scoped_exported_and_cascades():
    url = os.environ.get("STUDYVAULT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("STUDYVAULT_TEST_DATABASE_URL not set")
    owner, other = str(uuid4()), str(uuid4())
    with psycopg.connect(url) as conn:
        conn.executemany(
            "INSERT INTO users (id,clerk_id,email) VALUES (%s,%s,%s)",
            [(uid, f"recommendation-{uid}", f"{uid}@example.test") for uid in (owner, other)],
        )
    store = PgRecommendationStore(url)
    snapshot = RecommendationResponse(
        policy_version="career-next-action-v1",
        track_id="analyst",
        plan_revision=1,
        available_minutes=20,
        due_reviews=2,
        mastery=[],
        next_action=None,
        blocked=[],
    )
    try:
        store.save(owner, snapshot)
        assert store.save(other, snapshot) is None
        privacy = PrivacyStore(url)
        try:
            exported = privacy.export_user_data(owner)["tables"]["learner_recommendation_snapshots"]
            assert len(exported) == 1
            assert exported[0]["snapshot"] == snapshot.model_dump(mode="json")
            assert privacy.export_user_data(other)["tables"]["learner_recommendation_snapshots"][0]["snapshot"][
                "track_id"
            ] == "analyst"
            assert privacy.delete_user_data(owner) == 1
        finally:
            privacy.close()
        with psycopg.connect(url) as conn:
            assert conn.execute(
                "SELECT 1 FROM learner_recommendation_snapshots WHERE user_id=%s", (owner,)
            ).fetchone() is None
            assert conn.execute("SELECT 1 FROM users WHERE id=%s", (other,)).fetchone() == (1,)
    finally:
        with psycopg.connect(url) as conn:
            conn.execute("DELETE FROM users WHERE id=%s", (other,))
