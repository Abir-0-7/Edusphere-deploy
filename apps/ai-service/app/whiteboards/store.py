"""Owner-scoped, revisioned whiteboard snapshots and opaque image assets."""

from dataclasses import dataclass
from datetime import UTC, datetime
from threading import RLock
from typing import Protocol
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.errors import Conflict
from app.whiteboards.contracts import (
    MAX_ASSETS,
    MAX_BOARD_ASSET_BYTES,
    WhiteboardAssetResponse,
    WhiteboardScene,
    WhiteboardSnapshot,
    asset_sha256,
)


@dataclass(frozen=True)
class BoardAsset:
    id: UUID
    board_id: UUID
    user_id: str
    file_id: str
    mime_type: str
    size_bytes: int
    sha256: str
    data: bytes
    created_at: datetime

    def response(self) -> WhiteboardAssetResponse:
        return WhiteboardAssetResponse(
            id=self.id,
            file_id=self.file_id,
            mime_type=self.mime_type,
            size_bytes=self.size_bytes,
            sha256=self.sha256,
            created_at=self.created_at,
        )


class WhiteboardStore(Protocol):
    def list_boards(self, user_id: str, *, limit: int, offset: int) -> tuple[list[WhiteboardSnapshot], int]: ...
    def get_board(self, user_id: str, board_id: UUID) -> WhiteboardSnapshot | None: ...
    def create_board(self, user_id: str, title: str, scene: WhiteboardScene) -> WhiteboardSnapshot: ...
    def update_board(
        self, user_id: str, board_id: UUID, title: str, scene: WhiteboardScene, *, expected_revision: int
    ) -> WhiteboardSnapshot | None: ...
    def delete_board(self, user_id: str, board_id: UUID) -> bool: ...
    def list_assets(self, user_id: str, board_id: UUID) -> list[WhiteboardAssetResponse] | None: ...
    def create_asset(
        self, user_id: str, board_id: UUID, file_id: str, mime_type: str, data: bytes
    ) -> BoardAsset | None: ...
    def get_asset(self, user_id: str, board_id: UUID, asset_id: UUID) -> BoardAsset | None: ...
    def delete_asset(self, user_id: str, board_id: UUID, asset_id: UUID) -> bool | None: ...


def _now() -> datetime:
    return datetime.now(UTC)


def _snapshot(
    board_id: UUID, title: str, revision: int, updated_at: datetime, scene: WhiteboardScene
) -> WhiteboardSnapshot:
    return WhiteboardSnapshot(
        board_id=board_id,
        title=title,
        revision=revision,
        updated_at=updated_at,
        renderer={"id": "excalidraw", "version": "0.18.1"},
        scene=scene,
    )


def _scene_file_ids(scene: WhiteboardScene) -> set[str]:
    return set(scene.file_ids)


def _validate_scene_assets(scene: WhiteboardScene, file_ids: set[str]) -> None:
    if not _scene_file_ids(scene) <= file_ids:
        raise ValueError("scene file IDs must reference an owner-authorized board asset")


class MemoryWhiteboardStore:
    def __init__(self, *, max_boards_per_user: int = 100) -> None:
        if max_boards_per_user < 1:
            raise ValueError("max_boards_per_user must be positive")
        self.max_boards_per_user = max_boards_per_user
        self._boards: dict[tuple[str, UUID], tuple[str, int, datetime, WhiteboardScene]] = {}
        self._assets: dict[tuple[str, UUID, UUID], BoardAsset] = {}
        self._lock = RLock()

    def _board_assets(self, user_id: str, board_id: UUID) -> list[BoardAsset]:
        return [asset for (owner, target, _), asset in self._assets.items() if owner == user_id and target == board_id]

    def list_boards(self, user_id: str, *, limit: int, offset: int) -> tuple[list[WhiteboardSnapshot], int]:
        with self._lock:
            rows = [(board_id, *values) for (owner, board_id), values in self._boards.items() if owner == user_id]
            rows.sort(key=lambda row: (row[3], row[0].int), reverse=True)
            snapshots = [
                _snapshot(board_id, title, revision, updated_at, scene.model_copy(deep=True))
                for board_id, title, revision, updated_at, scene in rows[offset : offset + limit]
            ]
            return snapshots, len(rows)

    def get_board(self, user_id: str, board_id: UUID) -> WhiteboardSnapshot | None:
        with self._lock:
            row = self._boards.get((user_id, board_id))
            return _snapshot(board_id, row[0], row[1], row[2], row[3].model_copy(deep=True)) if row else None

    def create_board(self, user_id: str, title: str, scene: WhiteboardScene) -> WhiteboardSnapshot:
        with self._lock:
            if sum(owner == user_id for owner, _ in self._boards) >= self.max_boards_per_user:
                raise ValueError("whiteboard limit reached for this account")
            if scene.file_ids:
                raise ValueError("upload authorized image assets before referencing them in a new board")
            board_id = uuid4()
            now = _now()
            snapshot = _snapshot(board_id, title, 1, now, scene.model_copy(deep=True))
            self._boards[(user_id, board_id)] = (title, 1, now, snapshot.scene.model_copy(deep=True))
            return snapshot

    def update_board(
        self, user_id: str, board_id: UUID, title: str, scene: WhiteboardScene, *, expected_revision: int
    ) -> WhiteboardSnapshot | None:
        with self._lock:
            old = self._boards.get((user_id, board_id))
            if old is None:
                return None
            if old[1] != expected_revision:
                raise Conflict(
                    "This whiteboard changed. Reload it before saving.", details={"current_revision": old[1]}
                )
            _validate_scene_assets(scene, {asset.file_id for asset in self._board_assets(user_id, board_id)})
            revision = old[1] + 1
            now = _now()
            cloned = scene.model_copy(deep=True)
            snapshot = _snapshot(board_id, title, revision, now, cloned.model_copy(deep=True))
            self._boards[(user_id, board_id)] = (title, revision, now, cloned)
            return snapshot

    def delete_board(self, user_id: str, board_id: UUID) -> bool:
        with self._lock:
            deleted = self._boards.pop((user_id, board_id), None) is not None
            if deleted:
                for key in [key for key in self._assets if key[:2] == (user_id, board_id)]:
                    self._assets.pop(key, None)
            return deleted

    def list_assets(self, user_id: str, board_id: UUID) -> list[WhiteboardAssetResponse] | None:
        with self._lock:
            if (user_id, board_id) not in self._boards:
                return None
            return [asset.response() for asset in self._board_assets(user_id, board_id)]

    def create_asset(
        self, user_id: str, board_id: UUID, file_id: str, mime_type: str, data: bytes
    ) -> BoardAsset | None:
        with self._lock:
            if (user_id, board_id) not in self._boards:
                return None
            assets = self._board_assets(user_id, board_id)
            existing = next((asset for asset in assets if asset.file_id == file_id), None)
            digest = asset_sha256(data)
            if existing:
                if existing.sha256 == digest and existing.mime_type == mime_type:
                    return existing
                raise Conflict("Image file IDs are immutable. Insert the changed image with a new file ID.")
            if len(assets) >= MAX_ASSETS:
                raise ValueError("a whiteboard may contain at most 200 image assets")
            if sum(asset.size_bytes for asset in assets) + len(data) > MAX_BOARD_ASSET_BYTES:
                raise ValueError("whiteboard assets exceed the 50 MiB board limit")
            asset = BoardAsset(uuid4(), board_id, user_id, file_id, mime_type, len(data), digest, bytes(data), _now())
            self._assets[(user_id, board_id, asset.id)] = asset
            return asset

    def get_asset(self, user_id: str, board_id: UUID, asset_id: UUID) -> BoardAsset | None:
        with self._lock:
            return self._assets.get((user_id, board_id, asset_id))

    def delete_asset(self, user_id: str, board_id: UUID, asset_id: UUID) -> bool | None:
        with self._lock:
            board = self._boards.get((user_id, board_id))
            if board is None:
                return None
            asset = self._assets.get((user_id, board_id, asset_id))
            if asset is None:
                return True
            if asset.file_id in board[3].file_ids:
                raise Conflict("Remove this image from the current scene before deleting its asset.")
            self._assets.pop((user_id, board_id, asset_id), None)
            return True


class PgWhiteboardStore:
    def __init__(self, database_url: str, *, max_boards_per_user: int = 100) -> None:
        self.database_url = database_url
        self.max_boards_per_user = max_boards_per_user

    @staticmethod
    def _record(row: dict) -> WhiteboardSnapshot:
        return _snapshot(
            row["id"], row["title"], row["revision"], row["updated_at"], WhiteboardScene.model_validate(row["scene"])
        )

    def list_boards(self, user_id: str, *, limit: int, offset: int) -> tuple[list[WhiteboardSnapshot], int]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            rows = conn.execute(
                "SELECT id,title,revision,updated_at,scene FROM whiteboards WHERE user_id=%s "
                "ORDER BY updated_at DESC,id DESC LIMIT %s OFFSET %s",
                (user_id, limit, offset),
            ).fetchall()
            total = conn.execute("SELECT count(*) AS count FROM whiteboards WHERE user_id=%s", (user_id,)).fetchone()
        return [self._record(row) for row in rows], int(total["count"])

    def get_board(self, user_id: str, board_id: UUID) -> WhiteboardSnapshot | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT id,title,revision,updated_at,scene FROM whiteboards WHERE user_id=%s AND id=%s",
                (user_id, board_id),
            ).fetchone()
        return self._record(row) if row else None

    def create_board(self, user_id: str, title: str, scene: WhiteboardScene) -> WhiteboardSnapshot:
        if scene.file_ids:
            raise ValueError("upload authorized image assets before referencing them in a new board")
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn, conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (user_id,))
            count = conn.execute("SELECT count(*) AS count FROM whiteboards WHERE user_id=%s", (user_id,)).fetchone()
            if int(count["count"]) >= self.max_boards_per_user:
                raise ValueError("whiteboard limit reached for this account")
            board_id = uuid4()
            row = conn.execute(
                "INSERT INTO whiteboards(id,user_id,title,revision,scene) VALUES (%s,%s,%s,1,%s) "
                "RETURNING id,title,revision,updated_at,scene",
                (board_id, user_id, title, Jsonb(scene.model_dump())),
            ).fetchone()
            # Validate the complete envelope before committing so a size failure
            # cannot leave behind a board that no client can reload.
            return self._record(row)

    def update_board(
        self, user_id: str, board_id: UUID, title: str, scene: WhiteboardScene, *, expected_revision: int
    ) -> WhiteboardSnapshot | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn, conn.transaction():
            row = conn.execute(
                "SELECT revision FROM whiteboards WHERE user_id=%s AND id=%s FOR UPDATE", (user_id, board_id)
            ).fetchone()
            if row is None:
                return None
            current_revision = int(row["revision"])
            if current_revision != expected_revision:
                raise Conflict(
                    "This whiteboard changed. Reload it before saving.", details={"current_revision": current_revision}
                )
            assets = conn.execute(
                "SELECT file_id FROM whiteboard_assets WHERE user_id=%s AND board_id=%s", (user_id, board_id)
            ).fetchall()
            _validate_scene_assets(scene, {asset["file_id"] for asset in assets})
            saved = conn.execute(
                "UPDATE whiteboards SET title=%s,scene=%s,revision=revision+1,updated_at=now() "
                "WHERE user_id=%s AND id=%s RETURNING id,title,revision,updated_at,scene",
                (title, Jsonb(scene.model_dump()), user_id, board_id),
            ).fetchone()
            return self._record(saved) if saved else None

    def delete_board(self, user_id: str, board_id: UUID) -> bool:
        with psycopg.connect(self.database_url) as conn:
            row = conn.execute(
                "DELETE FROM whiteboards WHERE user_id=%s AND id=%s RETURNING id", (user_id, board_id)
            ).fetchone()
        return row is not None

    def list_assets(self, user_id: str, board_id: UUID) -> list[WhiteboardAssetResponse] | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            board = conn.execute(
                "SELECT id FROM whiteboards WHERE user_id=%s AND id=%s", (user_id, board_id)
            ).fetchone()
            if board is None:
                return None
            rows = conn.execute(
                "SELECT id,file_id,mime_type,size_bytes,sha256,created_at FROM whiteboard_assets "
                "WHERE user_id=%s AND board_id=%s ORDER BY created_at,id",
                (user_id, board_id),
            ).fetchall()
        return [WhiteboardAssetResponse.model_validate(row) for row in rows]

    def create_asset(
        self, user_id: str, board_id: UUID, file_id: str, mime_type: str, data: bytes
    ) -> BoardAsset | None:
        digest = asset_sha256(data)
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn, conn.transaction():
            board = conn.execute(
                "SELECT id FROM whiteboards WHERE user_id=%s AND id=%s FOR UPDATE", (user_id, board_id)
            ).fetchone()
            if board is None:
                return None
            rows = conn.execute(
                "SELECT id,file_id,mime_type,size_bytes,sha256,created_at FROM whiteboard_assets "
                "WHERE user_id=%s AND board_id=%s FOR UPDATE",
                (user_id, board_id),
            ).fetchall()
            old = next((row for row in rows if row["file_id"] == file_id), None)
            if old:
                if old["sha256"] == digest and old["mime_type"] == mime_type:
                    return BoardAsset(
                        old["id"],
                        board_id,
                        user_id,
                        old["file_id"],
                        old["mime_type"],
                        old["size_bytes"],
                        old["sha256"],
                        bytes(data),
                        old["created_at"],
                    )
                raise Conflict("Image file IDs are immutable. Insert the changed image with a new file ID.")
            if len(rows) >= MAX_ASSETS:
                raise ValueError("a whiteboard may contain at most 200 image assets")
            if sum(int(row["size_bytes"]) for row in rows) + len(data) > MAX_BOARD_ASSET_BYTES:
                raise ValueError("whiteboard assets exceed the 50 MiB board limit")
            asset_id = uuid4()
            row = conn.execute(
                "INSERT INTO whiteboard_assets(id,user_id,board_id,file_id,mime_type,size_bytes,sha256,data) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id,file_id,mime_type,size_bytes,sha256,data,created_at",
                (asset_id, user_id, board_id, file_id, mime_type, len(data), digest, data),
            ).fetchone()
        return BoardAsset(
            row["id"],
            board_id,
            user_id,
            row["file_id"],
            row["mime_type"],
            row["size_bytes"],
            row["sha256"],
            bytes(row["data"]),
            row["created_at"],
        )

    def get_asset(self, user_id: str, board_id: UUID, asset_id: UUID) -> BoardAsset | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT id,file_id,mime_type,size_bytes,sha256,data,created_at FROM whiteboard_assets "
                "WHERE user_id=%s AND board_id=%s AND id=%s",
                (user_id, board_id, asset_id),
            ).fetchone()
        return (
            BoardAsset(
                row["id"],
                board_id,
                user_id,
                row["file_id"],
                row["mime_type"],
                row["size_bytes"],
                row["sha256"],
                bytes(row["data"]),
                row["created_at"],
            )
            if row
            else None
        )

    def delete_asset(self, user_id: str, board_id: UUID, asset_id: UUID) -> bool | None:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn, conn.transaction():
            board = conn.execute(
                "SELECT scene FROM whiteboards WHERE user_id=%s AND id=%s FOR UPDATE", (user_id, board_id)
            ).fetchone()
            if board is None:
                return None
            row = conn.execute(
                "SELECT file_id FROM whiteboard_assets WHERE user_id=%s AND board_id=%s AND id=%s",
                (user_id, board_id, asset_id),
            ).fetchone()
            if row is None:
                return True
            if row["file_id"] in (board["scene"] or {}).get("file_ids", []):
                raise Conflict("Remove this image from the current scene before deleting its asset.")
            conn.execute(
                "DELETE FROM whiteboard_assets WHERE user_id=%s AND board_id=%s AND id=%s",
                (user_id, board_id, asset_id),
            )
        return True
