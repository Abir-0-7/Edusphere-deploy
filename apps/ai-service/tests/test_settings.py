import pytest

from app.settings import Settings, get_settings


def test_provider_slots_use_only_logfare_then_groq() -> None:
    slots = get_settings().provider_slots()

    assert list(slots) == ["logfare:test-model-a", "logfare:test-model-a2", "groq"]
    assert slots["logfare:test-model-a"]["base_url"] == "https://primary.test/v1"
    assert slots["logfare:test-model-a2"]["api_key"] is None


def test_optional_huggingface_fallback_is_only_added_when_configured() -> None:
    settings = Settings(
        _env_file=None,
        AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
        AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
        AI_SERVICE_JOB_STORE="memory",
        AI_SERVICE_LLM_PROVIDER_ORDER="groq,huggingface",
        AI_SERVICE_LLM_GROQ_BASE_URL="https://groq.test/v1",
        AI_SERVICE_LLM_GROQ_MODEL="llama-test",
        AI_SERVICE_LLM_HUGGINGFACE_BASE_URL="https://router.huggingface.co/v1",
        AI_SERVICE_LLM_HUGGINGFACE_MODEL="org/test-instruct",
        AI_SERVICE_LLM_HUGGINGFACE_API_KEY="hf-test",
    )

    slots = settings.provider_slots()
    assert list(slots) == ["groq", "huggingface"]
    assert slots["huggingface"] == {
        "base_url": "https://router.huggingface.co/v1",
        "model": "org/test-instruct",
        "api_key": "hf-test",
    }


def test_provider_order_rejects_unrecognized_or_empty_chain() -> None:
    for chain in ("", "paid-vendor"):
        with pytest.raises(ValueError, match="AI_SERVICE_LLM_PROVIDER_ORDER"):
            Settings(
                _env_file=None,
                AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
                AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
                AI_SERVICE_JOB_STORE="memory",
                AI_SERVICE_LLM_PROVIDER_ORDER=chain,
            )


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


@pytest.mark.parametrize("mode", ["postgres", "auto"])
def test_durable_ai_admission_uses_postgres_when_upstash_is_not_configured(mode: str) -> None:
    settings = Settings(
        _env_file=None,
        AI_SERVICE_JOB_STORE=mode,
        UPSTASH_REDIS_REST_URL=None,
        UPSTASH_REDIS_REST_TOKEN=None,
    )
    assert settings.job_store == mode


@pytest.mark.parametrize(
    "name",
    [
        "AI_DAILY_LIMIT",
        "AI_RATE_LIMIT_PER_MIN",
        "AI_SERVICE_LLM_MAX_PROVIDER_ATTEMPTS",
        "AI_SERVICE_LLM_MAX_OUTPUT_TOKENS",
        "AI_SERVICE_LLM_MAX_INPUT_CHARS",
    ],
)
def test_ai_limits_cannot_disable_protection(name: str) -> None:
    with pytest.raises(ValueError, match=name):
        Settings(_env_file=None, **{name: 0})


@pytest.mark.parametrize("url", ["http://redis.test", "https://user:secret@redis.test", "https://redis.test?token=x"])
def test_rate_limit_endpoint_rejects_insecure_or_embedded_credentials(url: str) -> None:
    with pytest.raises(ValueError, match="UPSTASH_REDIS_REST_URL"):
        Settings(_env_file=None, UPSTASH_REDIS_REST_URL=url)


def test_response_cache_defaults_are_bounded_and_configurable() -> None:
    settings = Settings(
        _env_file=None,
        AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
        AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
        AI_SERVICE_JOB_STORE="memory",
    )
    assert settings.llm_cache_enabled is True
    assert settings.llm_cache_ttl_seconds == 86400
    assert settings.llm_cache_max_content_chars == 32000
    assert settings.llm_cache_max_entries_per_user == 100
    assert settings.llm_cache_policy_version == "2"

    configured = Settings(
        _env_file=None,
        AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
        AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
        AI_SERVICE_JOB_STORE="memory",
        AI_SERVICE_LLM_CACHE_TTL_SECONDS=1800,
        AI_SERVICE_LLM_CACHE_MAX_CONTENT_CHARS=8000,
        AI_SERVICE_LLM_CACHE_MAX_ENTRIES_PER_USER=12,
        AI_SERVICE_LLM_CACHE_POLICY_VERSION="course-v2",
    )
    assert configured.llm_cache_ttl_seconds == 1800
    assert configured.llm_cache_max_content_chars == 8000
    assert configured.llm_cache_max_entries_per_user == 12
    assert configured.llm_cache_policy_version == "course-v2"


def test_generation_budget_defaults_are_bounded_and_configurable() -> None:
    defaults = Settings(
        _env_file=None,
        AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
        AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
        AI_SERVICE_JOB_STORE="memory",
    )
    assert defaults.llm_user_daily_token_budget == 2_500_000
    assert defaults.llm_global_daily_token_budget == 50_000_000
    assert defaults.llm_feature_daily_token_budget == 5_000_000
    assert defaults.llm_user_generation_slots == 2
    assert defaults.llm_global_generation_slots == 20
    assert defaults.llm_generation_lease_seconds == 300
    configured = Settings(
        _env_file=None,
        AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
        AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
        AI_SERVICE_JOB_STORE="memory",
        AI_SERVICE_LLM_USER_DAILY_TOKEN_BUDGET=400_000,
        AI_SERVICE_LLM_GLOBAL_GENERATION_SLOTS=3,
    )
    assert configured.llm_user_daily_token_budget == 400_000
    assert configured.llm_global_generation_slots == 3


@pytest.mark.parametrize(
    "name",
    [
        "AI_SERVICE_LLM_USER_DAILY_TOKEN_BUDGET",
        "AI_SERVICE_LLM_GLOBAL_DAILY_TOKEN_BUDGET",
        "AI_SERVICE_LLM_FEATURE_DAILY_TOKEN_BUDGET",
        "AI_SERVICE_LLM_USER_GENERATION_SLOTS",
        "AI_SERVICE_LLM_GLOBAL_GENERATION_SLOTS",
        "AI_SERVICE_LLM_GENERATION_LEASE_SECONDS",
    ],
)
def test_generation_budgets_reject_zero(name: str) -> None:
    with pytest.raises(ValueError):
        Settings(_env_file=None, **{name: 0})


def test_generation_lease_must_cover_provider_timeouts_and_backoff() -> None:
    with pytest.raises(ValueError, match="must cover"):
        Settings(
            _env_file=None,
            AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
            AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
            AI_SERVICE_JOB_STORE="memory",
            AI_SERVICE_LLM_GENERATION_LEASE_SECONDS=30,
        )


@pytest.mark.parametrize(
    "name",
    [
        "AI_SERVICE_LLM_CACHE_TTL_SECONDS",
        "AI_SERVICE_LLM_CACHE_MAX_CONTENT_CHARS",
        "AI_SERVICE_LLM_CACHE_MAX_ENTRIES_PER_USER",
    ],
)
def test_response_cache_limits_must_remain_positive(name: str) -> None:
    with pytest.raises(ValueError, match=name):
        Settings(
            _env_file=None,
            AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
            AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
            AI_SERVICE_JOB_STORE="memory",
            **{name: 0},
        )


def test_storage_limits_have_bounded_defaults_and_can_be_tuned() -> None:
    settings = Settings(
        _env_file=None,
        AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
        AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
        AI_SERVICE_JOB_STORE="memory",
    )
    assert settings.max_documents_per_user == 100
    assert settings.max_chunks_per_document == 5000
    assert settings.max_flashcards_per_deck == 2000
    assert settings.max_embedding_batch == 500
    assert settings.max_page_size == 100
    configured = Settings(
        _env_file=None,
        AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
        AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
        AI_SERVICE_JOB_STORE="memory",
        AI_SERVICE_MAX_DOCUMENTS_PER_USER=25,
        AI_SERVICE_MAX_CHUNKS_PER_DOCUMENT=250,
        AI_SERVICE_MAX_FLASHCARDS_PER_DECK=400,
        AI_SERVICE_MAX_EMBEDDING_BATCH=200,
        AI_SERVICE_MAX_PAGE_SIZE=50,
    )
    assert configured.max_documents_per_user == 25
    assert configured.max_chunks_per_document == 250
    assert configured.max_flashcards_per_deck == 400
    assert configured.max_embedding_batch == 200
    assert configured.max_page_size == 50


def test_storage_limits_reject_invalid_values_and_incompatible_batches() -> None:
    for name in (
        "AI_SERVICE_MAX_DOCUMENTS_PER_USER",
        "AI_SERVICE_MAX_CHUNKS_PER_DOCUMENT",
        "AI_SERVICE_MAX_FLASHCARDS_PER_DECK",
        "AI_SERVICE_MAX_EMBEDDING_BATCH",
        "AI_SERVICE_MAX_PAGE_SIZE",
    ):
        with pytest.raises(ValueError):
            Settings(
                _env_file=None,
                AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
                AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
                AI_SERVICE_JOB_STORE="memory",
                **{name: 0},
            )
    with pytest.raises(ValueError, match="cover one embedding batch"):
        Settings(
            _env_file=None,
            AI_SERVICE_DATABASE_URL="postgresql://test:test@localhost:5432/test",
            AI_SERVICE_JWT_JWKS_URL="http://localhost/test-jwks",
            AI_SERVICE_JOB_STORE="memory",
            AI_SERVICE_MAX_CHUNKS_PER_DOCUMENT=100,
            AI_SERVICE_MAX_EMBEDDING_BATCH=200,
        )
