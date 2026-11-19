"""Adversarial fixed-origin GitHub HTTP boundary; no real sockets are opened."""

import json
import socket
import ssl
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import httpcore
import pytest

from app.errors import ApiError, InvalidInput, NotFound, RateLimited, TooLarge
from app.source_versions import github_http as transport


class Budget:
    def __init__(self, *, max_response=1024, max_wire=4096, remaining=30):
        self.limits = SimpleNamespace(request_timeout_seconds=5, max_response_bytes=max_response)
        self.max_wire, self.remaining = max_wire, remaining
        self.wire = self.requests = 0

    def check(self):
        if self.remaining <= 0:
            raise httpcore.ReadTimeout("deadline")
        return self.remaining

    def take_request(self):
        self.requests += 1

    def consume_wire(self, count):
        self.wire += count
        if self.wire > self.max_wire:
            raise TooLarge("wire limit")


class RecordingStream(httpcore.MockStream):
    def __init__(self, buffer):
        super().__init__(buffer)
        self.writes, self.tls, self.timeouts = [], [], []

    def write(self, buffer, timeout=None):
        self.writes.append(buffer)
        self.timeouts.append(timeout)

    def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        self.tls.append((server_hostname, ssl_context.check_hostname, ssl_context.verify_mode, timeout))
        return self

    def read(self, max_bytes, timeout=None):
        self.timeouts.append(timeout)
        return super().read(max_bytes, timeout)


def answer(value="140.82.112.5"):
    family = socket.AF_INET6 if ":" in value else socket.AF_INET
    address = (value, 443, 0, 0) if family == socket.AF_INET6 else (value, 443)
    return family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", address


def install_response(monkeypatch, body=b'{"ok":true}', *, status=200, headers=None):
    header_values = headers if headers is not None else [("Content-Type", "application/json")]
    raw = f"HTTP/1.1 {status} Example\r\n".encode()
    raw += b"".join(f"{key}: {value}\r\n".encode() for key, value in header_values)
    raw += f"Content-Length: {len(body)}\r\n\r\n".encode() + body
    stream = RecordingStream([raw])
    calls = []
    monkeypatch.setattr(transport.socket, "getaddrinfo", lambda *_: [answer()])

    def connect(_self, host, port, **kwargs):
        calls.append((host, port, kwargs))
        return stream

    monkeypatch.setattr(httpcore.SyncBackend, "connect_tcp", connect)
    return stream, calls


def test_transport_pins_numeric_tcp_and_preserves_verified_original_tls_host_without_credentials(monkeypatch):
    stream, calls = install_response(monkeypatch)
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:8888")
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:8888")
    monkeypatch.setenv("GITHUB_TOKEN", "must-never-be-sent")
    budget = Budget()
    assert transport.GithubHttp().get_json("/repos/example/teaching", budget=budget) == {"ok": True}
    assert calls[0][0:2] == ("140.82.112.5", 443)
    assert stream.tls == [("api.github.com", True, ssl.CERT_REQUIRED, 5)]
    request = b"".join(stream.writes).lower()
    assert b"host: api.github.com" in request and b"accept-encoding: identity" in request
    assert b"authorization" not in request and b"cookie" not in request and b"must-never-be-sent" not in request
    assert budget.requests == 1 and budget.wire == len(b'{"ok":true}')


@pytest.mark.parametrize("value", [
    "127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.0.8", "192.0.2.1",
    "::", "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:140.82.112.5",
    "64:ff9b::7f00:1", "64:ff9b:1::a00:1", "2002:7f00:1::", "2001:1::1", "2606:4700::1%3",
])
def test_special_private_mapped_and_transition_addresses_are_rejected(value):
    with pytest.raises(InvalidInput):
        transport._public_address(value)


def test_mixed_dns_answers_are_rejected_before_tcp_and_cannot_rebind(monkeypatch):
    install_response(monkeypatch)
    monkeypatch.setattr(transport.socket, "getaddrinfo", lambda *_: [answer(), answer("127.0.0.1")])
    monkeypatch.setattr(httpcore.SyncBackend, "connect_tcp", lambda *_a, **_k: pytest.fail("unsafe TCP connect"))
    with pytest.raises(InvalidInput, match="address"):
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget())


def test_only_one_real_hostname_resolution_precedes_numeric_socket_connection(monkeypatch):
    _, calls = install_response(monkeypatch)
    resolutions = []

    def dns(*args):
        resolutions.append(args)
        return [answer()] if len(resolutions) == 1 else [answer("127.0.0.1")]

    monkeypatch.setattr(transport.socket, "getaddrinfo", dns)
    assert transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget())["ok"]
    assert len(resolutions) == 1 and calls[0][0] == "140.82.112.5"


def test_dns_timeout_keeps_capacity_reserved_until_abandoned_resolver_finishes(monkeypatch):
    gate = threading.Event()
    executor = ThreadPoolExecutor(max_workers=1)
    monkeypatch.setattr(transport, "_DNS_EXECUTOR", executor)
    monkeypatch.setattr(transport, "_DNS_SLOTS", threading.BoundedSemaphore(1))

    def dns(*_):
        gate.wait(2)
        return [answer()]

    monkeypatch.setattr(transport.socket, "getaddrinfo", dns)
    try:
        with pytest.raises(httpcore.ConnectTimeout):
            transport._resolve(Budget(remaining=0.01))
        with pytest.raises(ApiError, match="capacity") as busy:
            transport._resolve(Budget())
        assert busy.value.status_code == 503
    finally:
        gate.set()
        executor.shutdown(wait=True)
    assert transport._DNS_SLOTS.acquire(blocking=False)
    transport._DNS_SLOTS.release()


@pytest.mark.parametrize("path", [
    "https://localhost/repos/x/y", "//127.0.0.1/a", "/repos/x/../git/trees/" + "a" * 40,
    "/repos/x/y?url=http://localhost", "/repos/x/y#fragment", "/repos/x/y/contents/secret",
    "/repos/x/y\r\nAuthorization: secret", "/repos/x/y/git/blobs/main",
])
def test_paths_cannot_supply_an_origin_or_unbounded_endpoint(path):
    budget = Budget()
    with pytest.raises(InvalidInput):
        transport.GithubHttp().get_json(path, budget=budget)
    assert budget.requests == 0


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_redirects_are_rejected_without_following_location(monkeypatch, status):
    _, calls = install_response(monkeypatch, status=status, headers=[("Location", "http://169.254.169.254/latest")])
    with pytest.raises(InvalidInput, match="redirect"):
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget())
    assert len(calls) == 1


@pytest.mark.parametrize("status,error,code", [(404, NotFound, 404), (403, RateLimited, 429),
                                             (429, RateLimited, 429), (500, ApiError, 503)])
def test_upstream_errors_are_sanitized_with_bounded_retry_hint(monkeypatch, status, error, code):
    install_response(monkeypatch, body=b"upstream-private-body", status=status, headers=[("Retry-After", "99999999")])
    with pytest.raises(error) as failure:
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget())
    assert failure.value.status_code == code
    assert "upstream-private-body" not in str(failure.value)
    if isinstance(failure.value, RateLimited):
        assert failure.value.details == {"retryAfterSeconds": 3600}


@pytest.mark.parametrize("status", [403, 429])
@pytest.mark.parametrize("headers,expected", [
    ({"Retry-After": "12", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1500"}, 12),
    ({"Retry-After": "0", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1500"}, 1),
    ({"Retry-After": "999999999999"}, 3600),
    ({"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1121"}, 121),
    ({"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "999"}, 1),
    ({"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1000"}, 1),
    ({"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "999999999999"}, 3600),
    ({"Retry-After": "invalid", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1121"}, 121),
    ({"Retry-After": "-1", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1121"}, 121),
    ({"Retry-After": "1.5", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1121"}, 121),
    ({"X-RateLimit-Remaining": "1", "X-RateLimit-Reset": "1121"}, 60),
    ({"X-RateLimit-Reset": "1121"}, 60),
    ({"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "-5"}, 60),
    ({"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1e10"}, 60),
    ({"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "9" * 100}, 60),
    ({"Retry-After": "invalid"}, 60),
    ({}, 60),
])
def test_retry_hint_honors_reset_epoch_and_retry_after_precedence(monkeypatch, status, headers, expected):
    monkeypatch.setattr(transport.time, "time", lambda: 1000.25)
    install_response(monkeypatch, body=b"not-returned", status=status, headers=list(headers.items()))
    with pytest.raises(RateLimited) as failure:
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget())
    assert failure.value.details == {"retryAfterSeconds": expected}
    assert "not-returned" not in str(failure.value)


@pytest.mark.parametrize("body", [
    b'{"duplicate":1,"duplicate":2}', b'{"a":{"nested":1,"nested":2}}', b'{"a":NaN}',
    b'{"a":Infinity}', b'{"a":1e999}', b"[]", b"not-json", b'{"a":"\xff"}',
    (b'{"a":' * 1100) + b"1" + (b"}" * 1100),
])
def test_invalid_nonfinite_duplicate_or_deep_json_fails_clearly(monkeypatch, body):
    install_response(monkeypatch, body=body)
    with pytest.raises(ApiError) as failure:
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget(max_response=20000, max_wire=20000))
    assert failure.value.status_code == 503 and body[:10].decode(errors="ignore") not in failure.value.message


def test_compression_and_non_json_responses_are_rejected(monkeypatch):
    install_response(monkeypatch, headers=[("Content-Type", "application/json"), ("Content-Encoding", "gzip")])
    with pytest.raises(InvalidInput, match="Compressed"):
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget())
    install_response(monkeypatch, headers=[("Content-Type", "text/html")])
    with pytest.raises(ApiError) as failure:
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget())
    assert failure.value.status_code == 503


def test_response_and_shared_wire_limits_apply_before_json_decoding(monkeypatch):
    install_response(monkeypatch, body=json.dumps({"large": "x" * 100}).encode())
    with pytest.raises(TooLarge):
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget(max_response=20))
    install_response(monkeypatch, body=json.dumps({"large": "x" * 100}).encode())
    with pytest.raises(TooLarge):
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget(max_wire=20))


def test_chunked_actual_length_is_bounded_without_trusting_content_length(monkeypatch):
    stream, _ = install_response(monkeypatch)
    stream._buffer = [
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n",
        b"10\r\n1234567890123456\r\n", b"10\r\n1234567890123456\r\n", b"0\r\n\r\n",
    ]
    with pytest.raises(TooLarge):
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget(max_response=20))


def test_every_low_level_read_write_and_tls_call_uses_remaining_deadline():
    budget = Budget(remaining=2)
    raw = RecordingStream([b"first", b"second"])
    stream = transport._DeadlineStream(raw, budget)
    stream.write(b"hello", timeout=10)
    assert stream.read(10, timeout=10) == b"first"
    budget.remaining = 0.1
    assert stream.read(10, timeout=10) == b"second"
    assert raw.timeouts == [2, 2, 0.1]
    budget.remaining = 0
    with pytest.raises(httpcore.ReadTimeout):
        stream.read(10)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    with pytest.raises(InvalidInput, match="TLS"):
        stream.start_tls(context, server_hostname="api.github.com")


def test_expired_entry_deadline_is_a_sanitized_service_error_without_connecting():
    with pytest.raises(ApiError, match="timed out") as failure:
        transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget(remaining=0))
    assert failure.value.status_code == 503


def test_unapproved_host_or_port_never_reaches_dns(monkeypatch):
    monkeypatch.setattr(transport.socket, "getaddrinfo", lambda *_: pytest.fail("unsafe DNS"))
    backend = transport.GithubNetworkBackend(Budget())
    for host, port in [("localhost", 443), ("api.github.com.evil.test", 443), ("api.github.com", 80)]:
        with pytest.raises(InvalidInput, match="destination"):
            backend.connect_tcp(host, port)


def test_strict_json_depth_scanner_ignores_braces_and_escaped_quotes_inside_strings(monkeypatch):
    body = json.dumps({"text": "[" * 100 + '{\\"quoted\\"}' + "]" * 100}).encode()
    install_response(monkeypatch, body=body)
    assert transport.GithubHttp().get_json("/repos/example/teaching", budget=Budget()) == json.loads(body)
