"""Shared error shape (mirrors packages/types ErrorSchema / docs/openapi.yaml)."""

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    status_code = 500
    code = "internal"

    def __init__(self, message: str | None = None, details: Any = None, status_code: int | None = None) -> None:
        super().__init__(message or self.code)
        self.message = message or self.code
        self.details = details
        if status_code is not None:
            self.status_code = status_code


class InvalidInput(ApiError):
    status_code, code = 400, "invalid_input"


class TooLarge(ApiError):
    status_code, code = 413, "file_too_large"


class Unauthorized(ApiError):
    status_code, code = 401, "unauthorized"


class NotFound(ApiError):
    status_code, code = 404, "not_found"


class RateLimited(ApiError):
    status_code, code = 429, "rate_limited"


class Conflict(ApiError):
    status_code, code = 409, "conflict"


def error_body(message: str, code: str, details: Any = None) -> dict[str, Any]:
    err: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        err["details"] = details
    return {"error": err}


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    headers = {}
    if isinstance(exc, RateLimited) and isinstance(exc.details, dict):
        retry = exc.details.get("retryAfterSeconds")
        if type(retry) is int and retry > 0:
            headers["Retry-After"] = str(retry)
    return JSONResponse(
        status_code=exc.status_code, content=error_body(exc.message, exc.code, exc.details), headers=headers
    )
