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
    circuit_failure_threshold: int = Field(3, alias="AI_SERVICE_CIRCUIT_FAILURE_THRESHOLD")
    circuit_cooldown_seconds: float = Field(300, alias="AI_SERVICE_CIRCUIT_COOLDOWN_SECONDS")

    max_upload_mb: int = Field(20, alias="AI_SERVICE_MAX_UPLOAD_MB")
    max_pages: int = Field(300, alias="AI_SERVICE_MAX_PAGES")

    # Ingest pipeline (tasks 2.2 / 2.4 / 2.7)
    worker_enabled: bool = Field(True, alias="AI_SERVICE_WORKER_ENABLED")
    # Job store backend (task 1.14): postgres | memory | auto (postgres, falling back to memory).
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
    cors_origins: str = Field(
        "http://localhost:3000,http://127.0.0.1:3000", alias="AI_SERVICE_CORS_ORIGINS"
    )
    course_lab_receipt_secret: str | None = Field(None, alias="AI_SERVICE_COURSE_LAB_RECEIPT_SECRET")

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

    @model_validator(mode="after")
    def _validate(self) -> "Settings":
        if self.llm_max_retries < 0:
            raise ValueError("AI_SERVICE_LLM_MAX_RETRIES must be >= 0")
        if self.max_upload_mb <= 0 or self.max_pages <= 0:
            raise ValueError("AI_SERVICE_MAX_UPLOAD_MB and AI_SERVICE_MAX_PAGES must be > 0")
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
        if self.course_lab_receipt_secret and len(self.course_lab_receipt_secret) < 32:
            raise ValueError("AI_SERVICE_COURSE_LAB_RECEIPT_SECRET must be at least 32 characters")
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
        return slots

    @property
    def llm_logfare_model(self) -> str | None:
        return next((model.strip() for model in self.llm_logfare_models.split(",") if model.strip()), None)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # populated from env / .env
