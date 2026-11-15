import os

# Required env vars must exist before app.settings is imported (fail-fast validation).
os.environ.setdefault("AI_SERVICE_DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("AI_SERVICE_JWT_JWKS_URL", "http://localhost/test-jwks")
os.environ.setdefault("AI_SERVICE_LLM_LOGFARE_BASE_URL", "https://primary.test/v1")
os.environ.setdefault("AI_SERVICE_LLM_LOGFARE_MODELS", "test-model-a,test-model-a2")
os.environ["AI_SERVICE_LLM_PROVIDER_ORDER"] = "logfare,groq"
os.environ.setdefault("AI_SERVICE_LLM_GROQ_BASE_URL", "https://groq.test/v1")
os.environ.setdefault("AI_SERVICE_LLM_GROQ_MODEL", "test-model-b")
os.environ.setdefault("AI_SERVICE_LLM_GROQ_API_KEY", "k")
# Tests drive the worker explicitly via worker.process_one(); no background loop.
os.environ.setdefault("AI_SERVICE_WORKER_ENABLED", "false")
# Never connect to a real database from unit tests (PgJobStore is tested separately,
# gated on STUDYVAULT_TEST_DATABASE_URL).
os.environ.setdefault("AI_SERVICE_JOB_STORE", "memory")
os.environ.setdefault("AI_SERVICE_JWT_DEV_MODE", "true")
# Never ship test-run errors to a real Sentry project (and never require the SDK).
os.environ["AI_SERVICE_SENTRY_DSN"] = ""
