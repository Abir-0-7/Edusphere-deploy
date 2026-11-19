"""Optional GitHub admission must not prevent a PostgreSQL API from starting."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import ApiError, api_error_handler
from app.settings import Settings
from app.source_versions.github_admission import (
    GithubImportSlots,
    MemoryGithubImportLimiter,
    UpstashGithubImportLimiter,
    github_import_limiter,
)
from app.source_versions.github_router import GithubImportService, github_import_router
from tests.github_repo_fixture import RepoFixture


def production_settings(**overrides):
    return Settings(
        _env_file=None,
        **{
            "AI_SERVICE_DATABASE_URL": "postgresql://test:test@127.0.0.1:1/test",
            "AI_SERVICE_JOB_STORE": "postgres",
            "AI_SERVICE_JWT_DEV_MODE": False,
            "AI_SERVICE_JWT_JWKS_URL": "https://clerk.test/jwks",
            "AI_SERVICE_GITHUB_IMPORT_ENABLED": False,
            "UPSTASH_REDIS_REST_URL": None,
            "UPSTASH_REDIS_REST_TOKEN": None,
            **overrides,
        },
    )


def test_disabled_postgres_import_starts_without_upstash_and_rejects_before_any_work(monkeypatch):
    def no_work(*args, **kwargs):
        raise AssertionError("disabled GitHub import performed work")

    # The real production settings and limiter factory need neither a database
    # connection nor an optional rate-limit service while the feature is off.
    settings = production_settings()
    monkeypatch.setattr("psycopg.connect", no_work)
    limiter = github_import_limiter(settings)
    assert isinstance(limiter, MemoryGithubImportLimiter)
    monkeypatch.setattr(limiter, "check", no_work)
    service = GithubImportService(
        SimpleNamespace(fetch=no_work), SimpleNamespace(save=no_work), limiter,
        GithubImportSlots(settings.github_import_max_active), enabled=settings.github_import_enabled,
    )
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(github_import_router(lambda: "owner", service))
    with TestClient(app) as client:
        response = client.post(
            "/api/source-versions/import-github", json=RepoFixture().request().model_dump(mode="json"),
        )
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "Public repository import is not enabled"


@pytest.mark.parametrize("missing", ["url", "token", "both"])
def test_enabled_postgres_import_still_requires_shared_upstash_credentials(missing):
    settings = production_settings(
        AI_SERVICE_GITHUB_IMPORT_ENABLED=True,
        UPSTASH_REDIS_REST_URL=None if missing in {"url", "both"} else "https://redis.test",
        UPSTASH_REDIS_REST_TOKEN=None if missing in {"token", "both"} else "test-token",
    )
    with pytest.raises(ValueError, match="Upstash rate-limit URL and token are required"):
        github_import_limiter(settings)


def test_enabled_postgres_import_uses_shared_admission_without_memory_fallback():
    settings = production_settings(
        AI_SERVICE_GITHUB_IMPORT_ENABLED=True,
        UPSTASH_REDIS_REST_URL="https://redis.test",
        UPSTASH_REDIS_REST_TOKEN="test-token",
    )
    assert isinstance(github_import_limiter(settings), UpstashGithubImportLimiter)


def test_enabled_memory_import_remains_usable_without_external_rate_limit_credentials():
    settings = production_settings(AI_SERVICE_JOB_STORE="memory", AI_SERVICE_GITHUB_IMPORT_ENABLED=True)
    assert isinstance(github_import_limiter(settings), MemoryGithubImportLimiter)
