"""Owner-scoped local text import with bounded request reads and an atomic final save."""

import asyncio
import threading
from contextlib import suppress

import psycopg
from fastapi import APIRouter, Depends, Request
from pydantic import ValidationError
from starlette.requests import ClientDisconnect

from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.errors import ApiError, InvalidInput, NotFound, TooLarge
from app.source_versions.contracts import SourceVersion
from app.source_versions.local_text import (
    MAX_REQUEST_BYTES,
    TEXT_IMPORT,
    PastedNotesRequest,
    TextFileRequest,
    prepare_text_snapshot,
)


async def _request_bytes(request: Request) -> bytearray:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json" or request.headers.get("content-encoding", "identity") != "identity":
        raise InvalidInput("Send an uncompressed JSON request", status_code=415)
    length = request.headers.get("content-length")
    if length is not None:
        if not length.isascii() or not length.isdecimal():
            raise InvalidInput("Invalid Content-Length")
        if len(length) > 8 or int(length) > MAX_REQUEST_BYTES:
            raise TooLarge("Text import request exceeds the 256 KiB limit")
    result = bytearray()
    async for chunk in request.stream():
        if len(result) + len(chunk) > MAX_REQUEST_BYTES:
            raise TooLarge("Text import request exceeds the 256 KiB limit")
        result.extend(chunk)
    return result


async def _observe_disconnect(request, cancelled):
    while not cancelled.is_set():
        if await request.is_disconnected():
            cancelled.set()
            return
        await asyncio.sleep(0.02)


def local_text_router(user_dependency, source_store, *, enabled=False):
    router = APIRouter(tags=["source-versions"], responses={
        **LEARNING_ERRORS, 408: {"model": ErrorEnvelope, "description": "Text import body read timed out"},
        409: {"model": ErrorEnvelope, "description": "Text import cancelled"},
        413: {"model": ErrorEnvelope, "description": "Text import exceeds its bounds"},
        415: {"model": ErrorEnvelope, "description": "Unsupported request media type"},
        503: {"model": ErrorEnvelope, "description": "Text import storage or capacity unavailable"},
    })
    user = Depends(user_dependency)
    slots = threading.BoundedSemaphore(2)

    @router.post("/api/source-versions/import-text", response_model=SourceVersion, openapi_extra={
        "requestBody": {"required": True, "content": {"application/json": {"schema": {"oneOf": [
            PastedNotesRequest.model_json_schema(), TextFileRequest.model_json_schema(),
        ]}}}},
    })
    async def import_text(request: Request, user_id: str = user):
        if not enabled:
            raise NotFound("Local text source import is not available")
        if not slots.acquire(blocking=False):
            raise ApiError("Local text import is busy; retry shortly", status_code=503)
        released_by_route = True
        cancelled = threading.Event()
        observer = None

        def checkpoint():
            if cancelled.is_set():
                raise ApiError("Local text import was cancelled", status_code=409)

        def prepare_and_save(body):
            # A disconnected client can still race with this complete atomic
            # transaction. Keep the slot until the transaction actually ends.
            try:
                snapshot = prepare_text_snapshot(body, checkpoint)
                checkpoint()
                return source_store.save(user_id, snapshot, timeout_seconds=5)
            finally:
                slots.release()

        try:
            async with asyncio.timeout(10):
                raw = await _request_bytes(request)
            body = TEXT_IMPORT.validate_json(raw)
            if await request.is_disconnected():
                raise ApiError("Local text import was cancelled", status_code=409)
            observer = asyncio.create_task(_observe_disconnect(request, cancelled))
            task = asyncio.create_task(asyncio.to_thread(prepare_and_save, body))
            released_by_route = False
            return await asyncio.shield(task)
        except ClientDisconnect as exc:
            raise ApiError("Local text import was cancelled", status_code=409) from exc
        except TimeoutError as exc:
            raise ApiError("Local text request took too long to arrive", status_code=408) from exc
        except ValidationError as exc:
            raise InvalidInput("Text import did not match the notes or UTF-8 text file contract") from exc
        except psycopg.Error as exc:
            raise ApiError("Local text import storage is temporarily unavailable", status_code=503) from exc
        finally:
            cancelled.set()
            if observer is not None:
                observer.cancel()
                with suppress(asyncio.CancelledError):
                    await observer
            if released_by_route:
                slots.release()

    return router
