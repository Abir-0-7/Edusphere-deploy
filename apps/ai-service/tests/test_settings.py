import pytest

from app.settings import Settings, get_settings


def test_provider_slots_use_only_logfare_then_groq() -> None:
    slots = get_settings().provider_slots()

    assert list(slots) == ["logfare:test-model-a", "logfare:test-model-a2", "groq"]
    assert slots["logfare:test-model-a"]["base_url"] == "https://primary.test/v1"
    assert slots["logfare:test-model-a2"]["api_key"] is None


@pytest.mark.parametrize(
    "origin",
    [
        "https://studyvault.example/path",
        "https://user:password@studyvault.example",
        "https://studyvault.example?tenant=other",
        "https://studyvault.example:99999",
        "https://",
        "*",
    ],
)
def test_cors_origins_must_be_explicit_origins(origin: str) -> None:
    with pytest.raises(ValueError, match="AI_SERVICE_CORS_ORIGINS"):
        Settings(
            AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
            AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
            AI_SERVICE_CORS_ORIGINS=origin,
        )


def test_cors_origins_allow_root_and_port() -> None:
    settings = Settings(
        AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
        AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
        AI_SERVICE_CORS_ORIGINS="https://studyvault.example/,http://localhost:3000",
    )
    assert settings.cors_origin_list() == ["https://studyvault.example", "http://localhost:3000"]


def test_optional_course_lab_receipt_secret_accepts_empty_but_rejects_short_values() -> None:
    base = {
        "AI_SERVICE_DATABASE_URL": "postgresql://test:test@localhost:5432/test",
        "AI_SERVICE_JWT_JWKS_URL": "http://localhost/test-jwks",
    }
    assert Settings(**base, AI_SERVICE_COURSE_LAB_RECEIPT_SECRET="").course_lab_receipt_secret == ""
    with pytest.raises(ValueError, match="at least 32 characters"):
        Settings(**base, AI_SERVICE_COURSE_LAB_RECEIPT_SECRET="short")
