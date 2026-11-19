"""Authenticated, bounded preview of changes and exact artifact references."""

import psycopg
from fastapi import APIRouter, Depends

from app.contracts import LEARNING_ERRORS, ErrorEnvelope
from app.errors import ApiError, NotFound
from app.source_refresh.contracts import SourceImpactRequest, SourceImpactResponse
from app.source_refresh.impact import compare_segments


def source_refresh_router(user_dependency, source_store, impact_index, *, enabled=False):
    router = APIRouter(prefix="/api/source-refresh", tags=["source-refresh"], responses={
        **LEARNING_ERRORS, 503: {"model": ErrorEnvelope, "description": "Source impact storage unavailable"},
    })
    User = Depends(user_dependency)

    @router.post("/impact", response_model=SourceImpactResponse)
    def preview(body: SourceImpactRequest, user_id: str = User):
        if not enabled:
            raise NotFound("Source impact preview is not available")
        try:
            old = source_store.get(user_id, str(body.old_version_id))
            new = source_store.get(user_id, str(body.new_version_id))
            if old is None or new is None:
                raise NotFound("Source version not found")
            segments, counts = compare_segments(old, new)
            changes = {item.old_segment_id: item.change for item in segments
                       if item.old_segment_id is not None and item.change != "unchanged"}
            artifacts, scan_truncated, limitations = impact_index.artifacts(user_id, old, changes)
        except psycopg.Error as exc:
            raise ApiError("Source impact preview is temporarily unavailable", status_code=503) from exc

        # Keep unchanged segments in the totals. Page through actual changes so a
        # long unchanged prefix does not obscure the evidence the owner needs.
        changed_segments = [item for item in segments if item.change != "unchanged"]
        start, stop = body.offset, body.offset + body.limit
        return SourceImpactResponse(
            old_version_id=old.id, new_version_id=new.id,
            old_content_hash=old.content_hash, new_content_hash=new.content_hash,
            counts=counts, segments=changed_segments[start:stop], segments_truncated=stop < len(changed_segments),
            artifacts=artifacts[start:stop], total_artifacts=len(artifacts),
            artifacts_truncated=scan_truncated or stop < len(artifacts),
            limit=body.limit, offset=body.offset, limitations=limitations,
        )

    return router
