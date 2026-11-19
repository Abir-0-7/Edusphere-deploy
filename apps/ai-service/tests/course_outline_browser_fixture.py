"""Real in-memory F03 API for isolated Playwright, with owner-specific source seeds."""

import threading

from fastapi import FastAPI, Header
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.course_outlines.router import course_outline_router
from app.course_outlines.store import MemoryOutlineStore
from app.documents.store import InMemoryDocumentStore
from app.errors import ApiError, Unauthorized, api_error_handler, error_body
from app.source_versions.local_text_router import local_text_router
from app.source_versions.router import source_version_router
from app.source_versions.store import MemorySourceVersionStore
from tests.course_outline_fixture import seed_sources

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:4333"], allow_methods=["*"], allow_headers=["*"])
app.add_exception_handler(ApiError, api_error_handler)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _exc):
    return JSONResponse(status_code=400, content=error_body("Invalid outline request", "invalid_input"))


documents = InMemoryDocumentStore()
sources = MemorySourceVersionStore(documents)
outlines = MemoryOutlineStore(sources)
_seeded, _lock = set(), threading.RLock()


async def owner(authorization: str | None = Header(None)):
    if not authorization or not authorization.startswith("Bearer outline-fixture-"):
        raise Unauthorized()
    identifier = authorization.removeprefix("Bearer ")
    with _lock:
        if identifier not in _seeded:
            seed_sources(documents, sources, identifier)
            _seeded.add(identifier)
    return identifier


app.include_router(course_outline_router(owner, outlines, sources, enabled=True))
app.include_router(source_version_router(owner, sources, documents))
app.include_router(local_text_router(owner, sources, enabled=True))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/bibliography/library-documents")
def library_documents():
    # PDF preparation is covered by the F01 HTTP tests; the browser fixture uses
    # its two already-prepared owned sources instead of an upload flow.
    return {"documents": [], "limit": 100, "offset": 0, "total_count": 0}
