"""Embeddings (task 2.8). Config-driven backend, never torch on the API host.

Provider order: local ONNX (`fastembed`, no network) -> hosted HF Inference
endpoint (OpenAI-compatible /embeddings). Falls back to a deterministic
hashing trick only when neither is configured (dev/test only) so the pipeline
still exercises pgvector end to end without an API key.
"""

import hashlib
import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.settings import Settings

logger = logging.getLogger("studyvault.embeddings")

DIMENSION = 384  # MiniLM; matches the pgvector column.


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...
    @property
    def configured(self) -> bool: ...


@dataclass
class HostedEmbedder:
    """OpenAI-compatible /embeddings (hosted HF Inference, OpenRouter, etc.)."""

    base_url: str
    model: str
    api_key: str | None
    timeout_seconds: float = 30.0

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.model)

    def embed(self, texts: list[str]) -> list[list[float]]:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        body = {"model": self.model, "input": texts}
        with httpx.Client(timeout=self.timeout_seconds) as client:
            resp = client.post(f"{self.base_url.rstrip('/')}/embeddings", json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        return [item["embedding"] for item in data["data"]]


@dataclass
class LocalOnnxEmbedder:
    """fastembed/ONNX MiniLM — runs entirely locally, no API key."""

    model_name: str = "sentence-transformers/all-MiniLM-L6-v2"

    def __post_init__(self) -> None:
        self._model = None

    @property
    def configured(self) -> bool:
        return True

    def _load(self):
        if self._model is None:
            from fastembed import TextEmbedding

            self._model = TextEmbedding(model_name=self.model_name)
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        model = self._load()
        return [list(map(float, vec)) for vec in model.embed(texts)]


@dataclass
class HashEmbedder:
    """Deterministic 384-dim vector from a text hash. Dev/test fallback only —
    semantic quality is nil; it exists so the pgvector path stays exercised
    without an API key. Clearly flagged by `configured=False`."""

    @property
    def configured(self) -> bool:
        return False

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for text in texts:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            # 384 dims: 96 bytes x 4 repeats, centred on zero and normalised.
            vec = [(b - 128) / 128.0 for b in (digest * (DIMENSION // len(digest) + 1))[:DIMENSION]]
            norm = (sum(v * v for v in vec) ** 0.5) or 1.0
            out.append([v / norm for v in vec])
        return out


def embedder_from_settings(settings: Settings) -> Embedder:
    """backend: auto -> onnx if the package is installed, else hosted if
    configured, else hash (dev). Explicit 'onnx'/'hosted'/'hash' also allowed."""
    backend = settings.embedding_backend
    if backend in {"auto", "onnx"}:
        try:
            import fastembed  # noqa: F401

            return LocalOnnxEmbedder(model_name=settings.embedding_model)
        except ImportError:
            if backend == "onnx":
                raise RuntimeError("AI_SERVICE_EMBEDDING_BACKEND=onnx but fastembed is not installed") from None
    if backend in {"auto", "hosted"}:
        hosted = HostedEmbedder(
            base_url=settings.embedding_base_url or "",
            model=settings.embedding_model,
            api_key=settings.embedding_api_key,
        )
        if hosted.configured:
            return hosted
        if backend == "hosted":
            raise RuntimeError(
                "AI_SERVICE_EMBEDDING_BACKEND=hosted but base_url/model are not set"
            )
    if backend == "hash":
        return HashEmbedder()
    logger.warning("no embeddings backend configured; using hash fallback (dev only)")
    return HashEmbedder()
