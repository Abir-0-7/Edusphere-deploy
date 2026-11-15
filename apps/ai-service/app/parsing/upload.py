"""Bounded upload reading (task 2.1).

Reads an upload in fixed-size chunks and stops as soon as the size limit is
exceeded, so an oversized file never gets fully buffered in memory.
Duck-typed on `read(n)` so it works with FastAPI's UploadFile and in tests.
"""

from typing import Protocol

from app.errors import TooLarge

READ_CHUNK_BYTES = 1024 * 1024


class AsyncReadable(Protocol):
    async def read(self, size: int = -1) -> bytes: ...


async def read_bounded(file: AsyncReadable, *, max_mb: int) -> bytes:
    max_bytes = max_mb * 1024 * 1024
    parts: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise TooLarge(f"File exceeds the {max_mb} MB limit", details={"limit_bytes": max_bytes})
        parts.append(chunk)
    return b"".join(parts)
