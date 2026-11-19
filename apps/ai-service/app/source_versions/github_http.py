"""Fixed-origin, anonymous GitHub JSON transport with pinned public DNS answers.

HTTPX's default DNS resolution cannot bind a prior public-address check to the
actual socket. HTTPCore's public network backend interface provides that binding
while preserving the original HTTPS hostname for SNI and certificate checks.
"""

import ipaddress
import json
import math
import re
import socket
import ssl
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from typing import Protocol

import httpcore

from app.errors import ApiError, InvalidInput, NotFound, RateLimited, TooLarge

API_HOST = "api.github.com"
_PATH = re.compile(
    r"/repos/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9_.-]{1,100}"
    r"(?:/git/(?:commits|trees|blobs)/[0-9a-f]{40})?"
)
# Python 3.12.2 predates the 3.12.4 is_global classification corrections. These
# conservative exclusions also refuse IPv6 transition routes carrying IPv4.
_SPECIAL_NETWORKS = tuple(ipaddress.ip_network(value) for value in (
    "192.0.0.0/24", "64:ff9b::/96", "64:ff9b:1::/48", "2001::/23", "2002::/16",
))
_DNS_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="studyvault-github-dns")
_DNS_SLOTS = threading.BoundedSemaphore(2)


class HttpLimits(Protocol):
    request_timeout_seconds: float
    max_response_bytes: int


class HttpBudget(Protocol):
    limits: HttpLimits

    def check(self) -> float: ...
    def take_request(self) -> None: ...
    def consume_wire(self, count: int) -> None: ...


def _timeout(budget: HttpBudget, timeout: float | None = None) -> float:
    remaining = min(budget.check(), budget.limits.request_timeout_seconds)
    if timeout is not None:
        remaining = min(remaining, timeout)
    if remaining <= 0:
        raise httpcore.ReadTimeout("Repository request deadline exceeded")
    return remaining


def _public_address(value: str) -> str:
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise InvalidInput("Repository address is not permitted") from exc
    if (
        "%" in value
        or not address.is_global
        or address.is_reserved
        or address.is_multicast
        or address.is_loopback
        or address.is_link_local
        or address.is_unspecified
        or isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None
        or any(address.version == network.version and address in network for network in _SPECIAL_NETWORKS)
    ):
        raise InvalidInput("Repository address is not permitted")
    return str(address)


def _resolve(budget: HttpBudget) -> str:
    """Bound pending DNS work even when an OS resolver ignores cancellation."""
    if not _DNS_SLOTS.acquire(blocking=False):
        raise ApiError("Repository DNS capacity is temporarily unavailable", status_code=503)
    try:
        future = _DNS_EXECUTOR.submit(
            socket.getaddrinfo, API_HOST, 443, socket.AF_UNSPEC, socket.SOCK_STREAM, socket.IPPROTO_TCP,
        )
    except RuntimeError as exc:
        _DNS_SLOTS.release()
        raise ApiError("Repository DNS is temporarily unavailable", status_code=503) from exc
    # A timed-out caller never frees a slot while its resolver is still running.
    future.add_done_callback(lambda _: _DNS_SLOTS.release())
    try:
        answers = future.result(timeout=_timeout(budget))
    except TimeoutError as exc:
        future.cancel()
        raise httpcore.ConnectTimeout("Repository DNS timed out") from exc
    budget.check()
    if not answers or len(answers) > 16:
        raise InvalidInput("Repository DNS answer is not permitted")
    addresses = []
    for family, kind, protocol, _, sockaddr in answers:
        if family not in {socket.AF_INET, socket.AF_INET6} or kind != socket.SOCK_STREAM:
            raise InvalidInput("Repository DNS answer is not permitted")
        if protocol != socket.IPPROTO_TCP or len(sockaddr) < 2 or sockaddr[1] != 443:
            raise InvalidInput("Repository DNS answer is not permitted")
        if family == socket.AF_INET6 and len(sockaddr) >= 4 and sockaddr[3] != 0:
            raise InvalidInput("Repository scoped addresses are not permitted")
        # Reject the entire answer set on mixed public/private results.
        addresses.append(_public_address(sockaddr[0]))
    # Prefer IPv4 without creating a second hostname lookup or fallback attempt.
    return sorted(set(addresses), key=lambda value: (":" in value, value))[0]


class _DeadlineStream(httpcore.NetworkStream):
    def __init__(self, stream: httpcore.NetworkStream, budget: HttpBudget):
        self.stream, self.budget = stream, budget

    def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return self.stream.read(max_bytes, timeout=_timeout(self.budget, timeout))

    def write(self, buffer: bytes, timeout: float | None = None) -> None:
        self.stream.write(buffer, timeout=_timeout(self.budget, timeout))

    def close(self) -> None:
        self.stream.close()

    def start_tls(self, ssl_context, server_hostname: str | None = None, timeout: float | None = None):
        if (
            server_hostname != API_HOST or not ssl_context.check_hostname
            or ssl_context.verify_mode != ssl.CERT_REQUIRED
        ):
            raise InvalidInput("Repository TLS identity is not permitted")
        self.stream = self.stream.start_tls(
            ssl_context, server_hostname=API_HOST, timeout=_timeout(self.budget, timeout),
        )
        return self

    def get_extra_info(self, info: str):
        return self.stream.get_extra_info(info)


class GithubNetworkBackend(httpcore.NetworkBackend):
    """Connect only to the public numeric address checked for this request."""

    def __init__(self, budget: HttpBudget):
        self.budget = budget
        self.backend = httpcore.SyncBackend()

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if host != API_HOST or port != 443 or local_address is not None:
            raise InvalidInput("Repository request destination is not permitted")
        address = _resolve(self.budget)
        stream = self.backend.connect_tcp(
            address, 443, timeout=_timeout(self.budget, timeout), socket_options=socket_options,
        )
        return _DeadlineStream(stream, self.budget)


def _headers(values: list[tuple[bytes, bytes]]) -> dict[str, str]:
    result = {}
    for key, value in values:
        name = key.decode("ascii").lower()
        if name in {"content-length", "content-type", "content-encoding"} and name in result:
            raise ValueError("ambiguous repository response headers")
        result[name] = value.decode("ascii").strip()
    return result


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate repository JSON key")
        result[key] = value
    return result


def _constant(_):
    raise ValueError("non-finite repository JSON number")


def _float(value):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("non-finite repository JSON number")
    return result


def _bounded_json(raw: bytes) -> dict:
    # Reject excessive nesting before invoking the recursive JSON decoder.
    depth, quoted, escaped = 0, False, False
    for value in raw:
        if quoted:
            if escaped:
                escaped = False
            elif value == 92:
                escaped = True
            elif value == 34:
                quoted = False
        elif value == 34:
            quoted = True
        elif value in {91, 123}:
            depth += 1
            if depth > 64:
                raise ValueError("repository JSON nesting limit exceeded")
        elif value in {93, 125}:
            depth -= 1
    data = json.loads(raw.decode("utf-8"), object_pairs_hook=_object, parse_constant=_constant, parse_float=_float)
    if not isinstance(data, dict):
        raise ValueError("repository response must be an object")
    return data


def _retry_seconds(headers: dict[str, str]) -> int:
    delay = headers.get("retry-after", "")
    if re.fullmatch(r"[0-9]{1,12}", delay):
        return min(max(int(delay), 1), 3600)
    reset = headers.get("x-ratelimit-reset", "")
    if headers.get("x-ratelimit-remaining") == "0" and re.fullmatch(r"[0-9]{1,12}", reset):
        return min(max(math.ceil(int(reset) - time.time()), 1), 3600)
    return 60


class GithubHttp:
    """Anonymous read-only API requests; no URL, token, redirect or proxy input."""

    def get_json(self, path: str, *, budget: HttpBudget) -> dict:
        if not isinstance(path, str) or not _PATH.fullmatch(path) or path.split("/")[3] in {".", ".."}:
            raise InvalidInput("Repository request path is not permitted")
        try:
            budget.take_request()
            timeout = _timeout(budget)
            with httpcore.ConnectionPool(
                ssl_context=ssl.create_default_context(), network_backend=GithubNetworkBackend(budget),
                max_connections=1, max_keepalive_connections=0, retries=0, http1=True, http2=False,
            ) as pool:
                with pool.stream(
                    "GET", f"https://{API_HOST}{path}",
                    headers={
                        "Accept": "application/vnd.github+json", "Accept-Encoding": "identity",
                        "User-Agent": "StudyVault-public-source-import/1", "X-GitHub-Api-Version": "2026-03-10",
                    },
                    extensions={"timeout": {"connect": timeout, "read": timeout, "write": timeout, "pool": timeout}},
                ) as response:
                    headers = _headers(response.headers)
                    if 300 <= response.status < 400:
                        raise InvalidInput("Repository redirects are not permitted")
                    if response.status == 404:
                        raise NotFound("Public repository content not found")
                    if response.status in {403, 429}:
                        retry = _retry_seconds(headers)
                        raise RateLimited("Public repository service is rate limited", {"retryAfterSeconds": retry})
                    if response.status >= 500:
                        raise ApiError("Public repository service is temporarily unavailable", status_code=503)
                    if response.status != 200:
                        raise InvalidInput("Repository content cannot be read")
                    if headers.get("content-encoding", "identity").lower() != "identity":
                        raise InvalidInput("Compressed repository responses are not permitted")
                    media_type = headers.get("content-type", "").split(";", 1)[0].lower()
                    if not (media_type == "application/json" or media_type.startswith("application/")
                            and media_type.endswith("+json")):
                        raise ValueError("repository response is not JSON")
                    length = headers.get("content-length")
                    if length is not None:
                        if not re.fullmatch(r"[0-9]{1,12}", length):
                            raise ValueError("invalid repository Content-Length")
                        if int(length) > budget.limits.max_response_bytes:
                            raise TooLarge("Repository response exceeds the configured limit")
                    chunks, size = [], 0
                    for chunk in response.iter_stream():
                        budget.check()
                        size += len(chunk)
                        # Account for the raw HTTP body before UTF-8/JSON/base64 expansion.
                        budget.consume_wire(len(chunk))
                        if size > budget.limits.max_response_bytes:
                            raise TooLarge("Repository response exceeds the configured limit")
                        chunks.append(chunk)
                    data = _bounded_json(b"".join(chunks))
                    budget.check()
                    return data
        except ApiError:
            raise
        except httpcore.TimeoutException as exc:
            raise ApiError("Public repository request timed out", status_code=503) from exc
        except (
            httpcore.NetworkError, httpcore.ProtocolError, OSError, UnicodeError, ValueError, RecursionError,
        ) as exc:
            # Do not return upstream bodies, paths, resolver details or source text.
            raise ApiError("Public repository response is unavailable or invalid", status_code=503) from exc
