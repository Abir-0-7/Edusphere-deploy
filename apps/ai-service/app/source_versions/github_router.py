"""Opt-in authenticated F02 import; final storage remains the private F01 bridge."""

import asyncio
import threading

from fastapi import APIRouter, Depends, Request

from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.errors import ApiError, NotFound
from app.source_versions.contracts import SourceVersion
from app.source_versions.github_contracts import GithubImportRequest


class GithubImportService:
    def __init__(self, importer, store, limiter, slots, *, enabled=False, save_timeout_seconds=5):
        self.importer, self.store, self.limiter, self.slots = importer, store, limiter, slots
        self.enabled = enabled
        self.save_timeout_seconds = save_timeout_seconds

    def run(self, user_id: str, body: GithubImportRequest, cancelled: threading.Event) -> SourceVersion:
        if not self.enabled:
            raise NotFound("Public repository import is not enabled")
        with self.slots.acquire():
            if cancelled.is_set():
                raise ApiError("Repository import was cancelled", status_code=409)
            self.limiter.check(user_id)
            snapshot = self.importer.fetch(body, cancelled)
            if cancelled.is_set():
                raise ApiError("Repository import was cancelled", status_code=409)
            # One final write only. The durable store locks/rechecks the owner;
            # a deleted account cannot be recreated by a completed HTTP fetch.
            return self.store.save(user_id, snapshot, timeout_seconds=self.save_timeout_seconds)


def github_import_router(user_dependency, service: GithubImportService) -> APIRouter:
    router = APIRouter(tags=["source-versions"], responses={
        **LEARNING_ERRORS, 409: {"model": ErrorEnvelope, "description": "Import cancelled"},
        503: {"model": ErrorEnvelope, "description": "Repository service unavailable"},
    })
    User = Depends(user_dependency)

    @router.post("/api/source-versions/import-github", response_model=SourceVersion)
    async def import_github(body: GithubImportRequest, request: Request, user_id: str = User):
        cancelled = threading.Event()

        async def watch_disconnect():
            while not cancelled.is_set():
                if await request.is_disconnected():
                    cancelled.set()
                    return
                await asyncio.sleep(0.1)

        watcher = asyncio.create_task(watch_disconnect())
        try:
            return await asyncio.to_thread(service.run, user_id, body, cancelled)
        finally:
            cancelled.set()
            watcher.cancel()
            try:
                await watcher
            except asyncio.CancelledError:
                pass  # The owned disconnect monitor was deliberately cancelled.

    return router
