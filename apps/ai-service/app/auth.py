"""Clerk JWT verification (task 1.10).

Session tokens are RS256 JWTs signed by Clerk; the public keys are fetched from
`settings.jwt_jwks_url` and cached. The `sub` claim becomes the internal
`user_id` every query is scoped by.

The verifier is a small class (`TokenVerifier` protocol + `ClerkJwtVerifier`)
so tests can inject a fake signer; production uses `PyJWKClient` which handles
key rotation and caching.
"""

import logging
from dataclasses import dataclass
from typing import Protocol

import jwt
from jwt import PyJWKClient

from app.errors import Unauthorized
from app.settings import Settings

logger = logging.getLogger("studyvault.auth")

ALGORITHMS = ["RS256"]


class TokenVerifier(Protocol):
    def user_id(self, token: str) -> str: ...


@dataclass
class DevTokenVerifier:
    """Unsigned verifier for local dev and CI only (AI_SERVICE_JWT_DEV_MODE=true).

    Trusts the Bearer token as the user id. Never enable where the service is
    reachable from outside localhost."""

    def user_id(self, token: str) -> str:
        return token


@dataclass
class ClerkJwtVerifier:
    """Verifies Clerk session tokens against the configured JWKS endpoint.

    `jwks_source` is any object exposing `get_signing_key_from_jwt`; tests can
    pass a stub or a PyJWKClient pointed at a local JWKS fixture."""

    jwks_source: PyJWKClient
    issuer: str | None = None
    authorized_parties: frozenset[str] = frozenset()

    def _claims(self, token: str) -> dict[str, object]:
        try:
            signing_key = self.jwks_source.get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=ALGORITHMS,
                options={"verify_aud": False},  # Clerk session tokens have no `aud`
                issuer=self.issuer,
            )
        except jwt.PyJWTError as exc:
            logger.info("jwt verification failed: %s", type(exc).__name__)
            raise Unauthorized("invalid or expired token") from exc

    def user_id(self, token: str) -> str:
        claims = self._claims(token)
        if self.authorized_parties:
            azp = claims.get("azp")
            if not isinstance(azp, str) or azp not in self.authorized_parties:
                raise Unauthorized("token not issued for this application")

        sub = claims.get("sub")
        if not isinstance(sub, str) or not sub:
            raise Unauthorized("token has no subject")
        return sub


def _csv_to_set(value: str | None) -> frozenset[str]:
    if not value:
        return frozenset()
    return frozenset(p.strip() for p in value.split(",") if p.strip())


def verifier_from_settings(settings: Settings) -> TokenVerifier:
    """Dev mode (default) is unsigned so local runs need no key store; set
    AI_SERVICE_JWT_DEV_MODE=false to enforce real signature checks."""
    if settings.jwt_dev_mode:
        return DevTokenVerifier()
    return ClerkJwtVerifier(
        jwks_source=PyJWKClient(settings.jwt_jwks_url),
        issuer=settings.jwt_issuer or None,
        authorized_parties=_csv_to_set(settings.jwt_authorized_parties),
    )
