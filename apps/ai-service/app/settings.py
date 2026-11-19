"""Typed env validation. Fails fast at startup with a clear message (task 1.6)."""

from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(..., alias="AI_SERVICE_DATABASE_URL")
    jwt_jwks_url: str = Field(..., alias="AI_SERVICE_JWT_JWKS_URL")
    # Optional hardening for real Clerk tokens (task 1.10).
    jwt_issuer: str | None = Field(None, alias="AI_SERVICE_JWT_ISSUER")
    jwt_authorized_parties: str | None = Field(None, alias="AI_SERVICE_JWT_AUTHORIZED_PARTIES")
    # Unsigned dev auth for local runs/tests; set false in any deployed env.
    jwt_dev_mode: bool = Field(True, alias="AI_SERVICE_JWT_DEV_MODE")

    llm_provider_order: str = Field("logfare,groq", alias="AI_SERVICE_LLM_PROVIDER_ORDER")
    llm_timeout_seconds: float = Field(30, alias="AI_SERVICE_LLM_TIMEOUT_SECONDS")
    llm_max_retries: int = Field(2, alias="AI_SERVICE_LLM_MAX_RETRIES")
    llm_max_provider_attempts: int = Field(6, ge=1, le=100, alias="AI_SERVICE_LLM_MAX_PROVIDER_ATTEMPTS")
    llm_max_output_tokens: int = Field(4096, ge=1, le=32768, alias="AI_SERVICE_LLM_MAX_OUTPUT_TOKENS")
    llm_max_input_chars: int = Field(64000, ge=1, le=1000000, alias="AI_SERVICE_LLM_MAX_INPUT_CHARS")
    llm_cache_enabled: bool = Field(True, alias="AI_SERVICE_LLM_CACHE_ENABLED")
    llm_cache_ttl_seconds: int = Field(86400, ge=1, le=604800, alias="AI_SERVICE_LLM_CACHE_TTL_SECONDS")
    llm_cache_max_content_chars: int = Field(32000, ge=1, le=1000000, alias="AI_SERVICE_LLM_CACHE_MAX_CONTENT_CHARS")
    llm_cache_max_entries_per_user: int = Field(100, ge=1, le=10000, alias="AI_SERVICE_LLM_CACHE_MAX_ENTRIES_PER_USER")
    llm_cache_policy_version: str = Field("2", min_length=1, max_length=64, alias="AI_SERVICE_LLM_CACHE_POLICY_VERSION")
    llm_user_daily_token_budget: int = Field(
        2_500_000, ge=1, le=2_147_483_647, alias="AI_SERVICE_LLM_USER_DAILY_TOKEN_BUDGET"
    )
    llm_global_daily_token_budget: int = Field(
        50_000_000, ge=1, le=2_147_483_647, alias="AI_SERVICE_LLM_GLOBAL_DAILY_TOKEN_BUDGET"
    )
    llm_feature_daily_token_budget: int = Field(
        5_000_000, ge=1, le=2_147_483_647, alias="AI_SERVICE_LLM_FEATURE_DAILY_TOKEN_BUDGET"
    )
    llm_user_generation_slots: int = Field(2, ge=1, le=1000, alias="AI_SERVICE_LLM_USER_GENERATION_SLOTS")
    llm_global_generation_slots: int = Field(20, ge=1, le=10000, alias="AI_SERVICE_LLM_GLOBAL_GENERATION_SLOTS")
    llm_generation_lease_seconds: int = Field(300, ge=30, le=7200, alias="AI_SERVICE_LLM_GENERATION_LEASE_SECONDS")
    ai_daily_limit: int = Field(30, ge=1, le=100000, alias="AI_DAILY_LIMIT")
    ai_rate_limit_per_min: int = Field(30, ge=1, le=100000, alias="AI_RATE_LIMIT_PER_MIN")
    upstash_redis_rest_url: str | None = Field(None, alias="UPSTASH_REDIS_REST_URL")
    upstash_redis_rest_token: str | None = Field(None, alias="UPSTASH_REDIS_REST_TOKEN")
    circuit_failure_threshold: int = Field(3, alias="AI_SERVICE_CIRCUIT_FAILURE_THRESHOLD")
    circuit_cooldown_seconds: float = Field(300, alias="AI_SERVICE_CIRCUIT_COOLDOWN_SECONDS")

    max_upload_mb: int = Field(20, alias="AI_SERVICE_MAX_UPLOAD_MB")
    max_pages: int = Field(300, alias="AI_SERVICE_MAX_PAGES")
    # Bounded account/import/deck storage. These caps protect both durable and
    # development stores from unbounded rows or worker batches.
    max_documents_per_user: int = Field(100, ge=1, le=100000, alias="AI_SERVICE_MAX_DOCUMENTS_PER_USER")
    max_chunks_per_document: int = Field(5000, ge=1, le=100000, alias="AI_SERVICE_MAX_CHUNKS_PER_DOCUMENT")
    max_flashcards_per_deck: int = Field(2000, ge=1, le=100000, alias="AI_SERVICE_MAX_FLASHCARDS_PER_DECK")
    max_embedding_batch: int = Field(500, ge=1, le=5000, alias="AI_SERVICE_MAX_EMBEDDING_BATCH")
    max_page_size: int = Field(100, ge=1, le=1000, alias="AI_SERVICE_MAX_PAGE_SIZE")
    max_map_nodes: int = Field(500, ge=2, le=5000, alias="AI_SERVICE_MAX_MAP_NODES")

    # Ingest pipeline (tasks 2.2 / 2.4 / 2.7)
    worker_enabled: bool = Field(True, alias="AI_SERVICE_WORKER_ENABLED")
    # Job store backend (task 1.14): postgres/auto are durable, memory is explicit local/test mode.
    job_store: str = Field("auto", alias="AI_SERVICE_JOB_STORE")
    worker_poll_seconds: float = Field(1.0, alias="AI_SERVICE_WORKER_POLL_SECONDS")
    ocr_enabled: bool = Field(True, alias="AI_SERVICE_OCR_ENABLED")
    ocr_lang: str = Field("eng", alias="AI_SERVICE_OCR_LANG")
    structure_max_input_chars: int = Field(24000, alias="AI_SERVICE_STRUCTURE_MAX_INPUT_CHARS")
    max_chapters: int = Field(60, alias="AI_SERVICE_MAX_CHAPTERS")
    chunk_max_chars: int = Field(1200, alias="AI_SERVICE_CHUNK_MAX_CHARS")
    chunk_overlap_chars: int = Field(150, alias="AI_SERVICE_CHUNK_OVERLAP_CHARS")

    sentry_dsn: str | None = Field(None, alias="AI_SERVICE_SENTRY_DSN")
    log_level: str = Field("INFO", alias="AI_SERVICE_LOG_LEVEL")
    # Comma-separated browser origins permitted to call this API. Deployment
    # must replace the local defaults with the exact web origin.
    cors_origins: str = Field("http://localhost:3000,http://127.0.0.1:3000", alias="AI_SERVICE_CORS_ORIGINS")

    # Embeddings (task 2.8): local ONNX first, then a hosted endpoint, then a
    # hash fallback (dev only) so the vector path always runs.
    embedding_backend: str = Field("auto", alias="AI_SERVICE_EMBEDDING_BACKEND")  # auto|onnx|hosted|hash
    embedding_model: str = Field("sentence-transformers/all-MiniLM-L6-v2", alias="AI_SERVICE_EMBEDDING_MODEL")
    embedding_base_url: str | None = Field(None, alias="AI_SERVICE_EMBEDDING_BASE_URL")
    embedding_api_key: str | None = Field(None, alias="AI_SERVICE_EMBEDDING_API_KEY")

    # Per-provider slots; a provider without a base_url+model is skipped at runtime.
    llm_logfare_base_url: str | None = Field(None, alias="AI_SERVICE_LLM_LOGFARE_BASE_URL")
    llm_logfare_models: str = Field("glm-5.3", alias="AI_SERVICE_LLM_LOGFARE_MODELS")
    llm_logfare_api_key: str | None = Field(None, alias="AI_SERVICE_LLM_LOGFARE_API_KEY")
    llm_groq_base_url: str | None = Field(None, alias="AI_SERVICE_LLM_GROQ_BASE_URL")
    llm_groq_model: str | None = Field(None, alias="AI_SERVICE_LLM_GROQ_MODEL")
    llm_groq_api_key: str | None = Field(None, alias="AI_SERVICE_LLM_GROQ_API_KEY")
    # Optional third OpenAI-compatible endpoint. It runs only when explicitly
    # present in provider order; account quota and any free-tier eligibility
    # remain properties of the configured Hugging Face account.
    llm_huggingface_base_url: str | None = Field(None, alias="AI_SERVICE_LLM_HUGGINGFACE_BASE_URL")
    llm_huggingface_model: str | None = Field(None, alias="AI_SERVICE_LLM_HUGGINGFACE_MODEL")
    llm_huggingface_api_key: str | None = Field(None, alias="AI_SERVICE_LLM_HUGGINGFACE_API_KEY")

    @model_validator(mode="after")
    def _validate(self) -> "Settings":
        if self.llm_max_retries < 0:
            raise ValueError("AI_SERVICE_LLM_MAX_RETRIES must be >= 0")
        minimum_lease = self.llm_max_provider_attempts * (self.llm_timeout_seconds + 4.25) + 5
        if self.llm_generation_lease_seconds < minimum_lease:
            raise ValueError("AI_SERVICE_LLM_GENERATION_LEASE_SECONDS must cover the configured provider attempt bound")
        if self.max_upload_mb <= 0 or self.max_pages <= 0:
            raise ValueError("AI_SERVICE_MAX_UPLOAD_MB and AI_SERVICE_MAX_PAGES must be > 0")
        if self.max_chunks_per_document < self.max_embedding_batch:
            raise ValueError("AI_SERVICE_MAX_CHUNKS_PER_DOCUMENT must cover one embedding batch")
        if self.chunk_overlap_chars >= self.chunk_max_chars:
            raise ValueError("AI_SERVICE_CHUNK_OVERLAP_CHARS must be < AI_SERVICE_CHUNK_MAX_CHARS")
        if self.max_chapters <= 0 or self.structure_max_input_chars <= 0 or self.worker_poll_seconds <= 0:
            raise ValueError(
                "AI_SERVICE_MAX_CHAPTERS, AI_SERVICE_STRUCTURE_MAX_INPUT_CHARS and "
                "AI_SERVICE_WORKER_POLL_SECONDS must be > 0"
            )
        if not self.ocr_lang.replace("+", "").isalnum():
            raise ValueError("AI_SERVICE_OCR_LANG must look like 'eng' or 'eng+ben'")
        if self.job_store not in {"postgres", "memory", "auto"}:
            raise ValueError("AI_SERVICE_JOB_STORE must be one of: postgres, memory, auto")
        providers = [provider.strip() for provider in self.llm_provider_order.split(",") if provider.strip()]
        if not providers or set(providers) - {"logfare", "groq", "huggingface"}:
            raise ValueError("AI_SERVICE_LLM_PROVIDER_ORDER must contain logfare, groq, and/or huggingface")
        if self.upstash_redis_rest_url:
            rate_url = urlsplit(self.upstash_redis_rest_url)
            if (
                rate_url.scheme != "https"
                or not rate_url.hostname
                or rate_url.username
                or rate_url.password
                or rate_url.query
                or rate_url.fragment
            ):
                raise ValueError("UPSTASH_REDIS_REST_URL must be an HTTPS endpoint without credentials or query")
        if self.embedding_backend not in {"auto", "onnx", "hosted", "hash"}:
            raise ValueError("AI_SERVICE_EMBEDDING_BACKEND must be one of: auto, onnx, hosted, hash")
        origins = self.cors_origin_list()
        if not origins or "*" in origins:
            raise ValueError("AI_SERVICE_CORS_ORIGINS must contain explicit http(s) origins")
        for origin in origins:
            parsed = urlsplit(origin)
            try:
                port = parsed.port
            except ValueError as exc:
                raise ValueError("AI_SERVICE_CORS_ORIGINS entries must use a valid port") from exc
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
                or (port is not None and not 0 < port < 65536)
            ):
                raise ValueError("AI_SERVICE_CORS_ORIGINS entries must be explicit origins without paths")
        return self

    def cors_origin_list(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]

    def provider_slots(self) -> dict[str, dict[str, str | None]]:
        slots: dict[str, dict[str, str | None]] = {}
        configured_order = [provider.strip() for provider in self.llm_provider_order.split(",") if provider.strip()]
        for provider in configured_order:
            if provider == "logfare":
                for model in self.llm_logfare_models.split(","):
                    model = model.strip()
                    if model:
                        slots[f"logfare:{model}"] = {
                            "base_url": self.llm_logfare_base_url,
                            "model": model,
                            "api_key": self.llm_logfare_api_key,
                        }
            elif provider == "groq" and self.llm_groq_model:
                slots["groq"] = {
                    "base_url": self.llm_groq_base_url,
                    "model": self.llm_groq_model,
                    "api_key": self.llm_groq_api_key,
                }
            elif provider == "huggingface" and self.llm_huggingface_model:
                slots["huggingface"] = {
                    "base_url": self.llm_huggingface_base_url,
                    "model": self.llm_huggingface_model,
                    "api_key": self.llm_huggingface_api_key,
                }
        return slots

    @property
    def llm_logfare_model(self) -> str | None:
        return next((model.strip() for model in self.llm_logfare_models.split(",") if model.strip()), None)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # populated from env / .env
