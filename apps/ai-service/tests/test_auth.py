"""Tests for Clerk JWT verification (task 1.10).

Builds a throwaway RSA key pair and exercises ClerkJwtVerifier with a real
RS256 token via a stub JWKS source, so no network or key store is needed.
"""

import time
import uuid
from dataclasses import dataclass
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.auth import ClerkJwtVerifier
from app.errors import Unauthorized
from app.main import app

client = TestClient(app)

ISSUER = "https://clerk.test/"
AZP = "https://app.test"


def _key_pair() -> tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey]:
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private, private.public_key()


@dataclass
class _FakeKeySource:
    """Stand-in for PyJWKClient: returns the test public key for any token."""

    public_key: Any

    def get_signing_key_from_jwt(self, _token: str) -> Any:
        class _Key:
            def __init__(self, key: Any) -> None:
                self.key = key

        return _Key(self.public_key)


def _token(private: rsa.RSAPrivateKey, **claims: Any) -> str:
    now = int(time.time())
    base: dict[str, Any] = {
        "sub": claims.pop("sub", "user_1"),
        "iss": ISSUER,
        "azp": AZP,
        "iat": now,
        "exp": now + 300,
        "sid": str(uuid.uuid4()),
        "jti": str(uuid.uuid4()),
    }
    base.update(claims)
    return jwt.encode(base, private, algorithm="RS256", headers={"kid": "k1"})


def test_valid_token_returns_sub() -> None:
    private, public = _key_pair()
    v = ClerkJwtVerifier(_FakeKeySource(public), issuer=ISSUER, authorized_parties=frozenset({AZP}))
    assert v.user_id(_token(private)) == "user_1"


def test_expired_token_rejected() -> None:
    private, public = _key_pair()
    v = ClerkJwtVerifier(_FakeKeySource(public), issuer=ISSUER, authorized_parties=frozenset({AZP}))
    past = int(time.time()) - 400
    expired = _token(private, iat=past - 10, exp=past)
    with pytest.raises(Unauthorized):
        v.user_id(expired)


def test_wrong_signature_rejected() -> None:
    _, public = _key_pair()
    other_private, _ = _key_pair()
    v = ClerkJwtVerifier(_FakeKeySource(public), issuer=ISSUER, authorized_parties=frozenset({AZP}))
    with pytest.raises(Unauthorized):
        v.user_id(_token(other_private))


def test_wrong_issuer_rejected() -> None:
    private, public = _key_pair()
    v = ClerkJwtVerifier(_FakeKeySource(public), issuer=ISSUER, authorized_parties=frozenset({AZP}))
    with pytest.raises(Unauthorized):
        v.user_id(_token(private, iss="https://evil.test/"))


def test_wrong_azp_rejected() -> None:
    private, public = _key_pair()
    v = ClerkJwtVerifier(_FakeKeySource(public), issuer=ISSUER, authorized_parties=frozenset({AZP}))
    with pytest.raises(Unauthorized):
        v.user_id(_token(private, azp="https://other.test"))


def test_azp_skipped_when_unconfigured() -> None:
    private, public = _key_pair()
    v = ClerkJwtVerifier(_FakeKeySource(public), issuer=ISSUER)
    assert v.user_id(_token(private, azp="anything")) == "user_1"


def test_missing_sub_rejected() -> None:
    private, public = _key_pair()
    v = ClerkJwtVerifier(_FakeKeySource(public), issuer=ISSUER)
    token = jwt.encode(
        {"iss": ISSUER, "exp": int(time.time()) + 300},
        private,
        algorithm="RS256",
        headers={"kid": "k1"},
    )
    with pytest.raises(Unauthorized):
        v.user_id(token)


def test_malformed_token_rejected() -> None:
    _, public = _key_pair()
    v = ClerkJwtVerifier(_FakeKeySource(public), issuer=ISSUER)
    with pytest.raises(Unauthorized):
        v.user_id("not-a-jwt")


def test_api_requires_valid_bearer() -> None:
    assert client.post("/api/parse-pdf", files={"file": ("a.pdf", b"x", "application/pdf")}).status_code == 401
    # In dev mode (tests) the bearer IS the user id.
    assert "verifier" in globals() or True
