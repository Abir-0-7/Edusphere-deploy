"""Owner-scoped whiteboard snapshots and bounded image assets (E07)."""

import base64
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.errors import Conflict
from app.main import app
from app.whiteboards.contracts import WhiteboardScene
from app.whiteboards.store import MemoryWhiteboardStore

client = TestClient(app)


def auth(owner: str | None = None) -> dict[str, str]:
    return {"Authorization": f"Bearer whiteboard-test-{owner or uuid.uuid4()}"}


def empty_scene(**overrides):
    return {"elements": [], "app_state": {}, "file_ids": [], **overrides}


def png_payload(file_id: str = "opaque-image-id", data: bytes = b"\x89PNG\r\n\x1a\nsmall image payload"):
    return {"file_id": file_id, "mime_type": "image/png", "data_base64": base64.b64encode(data).decode("ascii")}


def test_whiteboard_routes_require_authentication():
    assert client.get("/api/whiteboards").status_code == 401
    assert client.post("/api/whiteboards", json={"title": "Board", "scene": empty_scene()}).status_code == 401


def test_owner_scoped_create_update_conflict_and_delete():
    first, second = auth(), auth()
    created = client.post("/api/whiteboards", headers=first, json={"title": "Algorithms", "scene": empty_scene()})
    assert created.status_code == 201
    board = created.json()
    assert board["revision"] == 1
    assert board["format"] == "studyvault-whiteboard"
    assert board["renderer"] == {"id": "excalidraw", "version": "0.18.1"}
    board_id = board["board_id"]

    assert client.get("/api/whiteboards", headers=second).json()["total_count"] == 0
    assert client.get(f"/api/whiteboards/{board_id}", headers=second).status_code == 404
    assert client.delete(f"/api/whiteboards/{board_id}", headers=second).status_code == 404

    changed = client.put(
        f"/api/whiteboards/{board_id}",
        headers=first,
        json={"title": "Algorithms v2", "scene": empty_scene(), "expected_revision": 1},
    )
    assert changed.status_code == 200 and changed.json()["revision"] == 2
    conflict = client.put(
        f"/api/whiteboards/{board_id}",
        headers=first,
        json={"title": "Lost update", "scene": empty_scene(), "expected_revision": 1},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["details"]["current_revision"] == 2
    assert client.delete(f"/api/whiteboards/{board_id}", headers=first).json() == {"id": board_id, "deleted": True}
    assert client.get(f"/api/whiteboards/{board_id}", headers=first).status_code == 404


def test_owner_scoped_assets_check_bytes_references_and_are_idempotent():
    first, other = auth(), auth()
    board_id = client.post("/api/whiteboards", headers=first, json={"title": "Drawing", "scene": empty_scene()}).json()[
        "board_id"
    ]
    payload = png_payload()
    uploaded = client.post(f"/api/whiteboards/{board_id}/assets", headers=first, json=payload)
    assert uploaded.status_code == 201
    manifest = uploaded.json()
    repeat = client.post(f"/api/whiteboards/{board_id}/assets", headers=first, json=payload)
    assert repeat.status_code == 201 and repeat.json()["id"] == manifest["id"]

    cross_owner = client.get(
        f"/api/whiteboards/{board_id}/assets/{manifest['id']}/content",
        headers=other,
    )
    assert cross_owner.status_code == 404
    downloaded = client.get(
        f"/api/whiteboards/{board_id}/assets/{manifest['id']}/content",
        headers=first,
    )
    assert downloaded.status_code == 200
    assert downloaded.content == base64.b64decode(payload["data_base64"])
    assert downloaded.headers["content-type"] == "image/png"
    assert downloaded.headers["etag"] == f'"{manifest["sha256"]}"'

    scene = empty_scene(
        elements=[{"id": "picture", "type": "image", "fileId": payload["file_id"]}],
        file_ids=[payload["file_id"]],
    )
    updated = client.put(
        f"/api/whiteboards/{board_id}",
        headers=first,
        json={"title": "Drawing", "scene": scene, "expected_revision": 1},
    )
    assert updated.status_code == 200
    assert client.delete(f"/api/whiteboards/{board_id}/assets/{manifest['id']}", headers=first).status_code == 409
    assert (
        client.put(
            f"/api/whiteboards/{board_id}",
            headers=first,
            json={"title": "Drawing", "scene": empty_scene(), "expected_revision": 2},
        ).status_code
        == 200
    )
    assert client.delete(f"/api/whiteboards/{board_id}/assets/{manifest['id']}", headers=first).status_code == 200

    invalid = client.post(
        f"/api/whiteboards/{board_id}/assets",
        headers=first,
        json={**payload, "mime_type": "image/jpeg"},
    )
    assert invalid.status_code == 400
    missing_asset = client.delete(f"/api/whiteboards/{board_id}/assets/{manifest['id']}", headers=first)
    assert missing_asset.status_code == 200


def test_owner_asset_and_board_retention_caps():
    store = MemoryWhiteboardStore(max_boards_per_user=1)
    owner = "cap-owner"
    board = store.create_board(owner, "Only board", WhiteboardScene.model_validate(empty_scene()))
    with pytest.raises(ValueError, match="whiteboard limit"):
        store.create_board(owner, "Second board", WhiteboardScene.model_validate(empty_scene()))
    png = b"\x89PNG\r\n\x1a\n"
    for index in range(200):
        asset = store.create_asset(owner, board.board_id, f"image-{index}", "image/png", png)
        assert asset is not None
    with pytest.raises(ValueError, match="at most 200"):
        store.create_asset(owner, board.board_id, "image-over-limit", "image/png", png)
    assert store.delete_board(owner, board.board_id)
    assert store.list_assets(owner, board.board_id) is None


def test_store_conflicts_and_immutable_assets_preserve_undo_content():
    store = MemoryWhiteboardStore()
    owner = "owner-a"
    board = store.create_board(owner, "Board", WhiteboardScene.model_validate(empty_scene()))
    with pytest.raises(Conflict):
        store.update_board(
            owner, board.board_id, "Stale", WhiteboardScene.model_validate(empty_scene()), expected_revision=2
        )
    first = store.create_asset(owner, board.board_id, "img", "image/png", b"\x89PNG\r\n\x1a\nfirst")
    with pytest.raises(Conflict, match="immutable"):
        store.create_asset(owner, board.board_id, "img", "image/png", b"\x89PNG\r\n\x1a\nsecond")
    assert first is not None
    assert store.get_asset(owner, board.board_id, first.id) == first


@pytest.mark.parametrize("scene", [
    empty_scene(elements=[{"id": "remote", "type": "embeddable", "link": "https://example.test"}]),
    empty_scene(elements=[{"id": "unsafe", "type": "image", "fileId": "missing"}]),
    empty_scene(file_ids=["unreferenced"]),
    empty_scene(elements=[{"id": "a", "type": "rectangle", "src": "HTTPS://example.test/image.png"}]),
    empty_scene(elements=[{"id": "a", "type": "rectangle", "data": {"__proto__": {}}}]),
    empty_scene(elements=[{"id": "a", "type": "rectangle", "x": float("inf")}]),
    empty_scene(elements=[{"id": "a", "type": "rectangle", "x": object()}]),
    empty_scene(elements=[{"id": "a", "type": "rectangle"}, {"id": "a", "type": "text"}]),
    empty_scene(elements=[{"id": "a", "type": {}}]),
    empty_scene(app_state={"collaborators": {"other": "private data"}}),
    empty_scene(app_state={"zoom": {"value": 1}}),
    empty_scene(app_state={"zoom": True}),
    empty_scene(app_state={"scrollX": 10**400}),
])
def test_scene_boundary_rejects_remote_assets_and_nonportable_state(scene):
    with pytest.raises(ValidationError):
        WhiteboardScene.model_validate(scene)


@pytest.mark.parametrize("reference", [
    {"containerId": "missing"}, {"frameId": "missing"},
    {"startBinding": {"elementId": "missing"}}, {"endBinding": {"elementId": "missing"}},
    {"boundElements": [{"id": "missing", "type": "text"}]}, {"boundElements": {}},
])
def test_broken_scene_references_are_rejected(reference):
    with pytest.raises(ValidationError, match="same scene"):
        WhiteboardScene.model_validate(empty_scene(elements=[{"id": "a", "type": "rectangle", **reference}]))


def test_valid_bound_text_arrow_and_frame_references_survive_validation():
    elements = [
        {"id": "frame", "type": "frame"},
        {"id": "shape", "type": "rectangle", "frameId": "frame", "boundElements": [{"id": "label", "type": "text"}]},
        {"id": "label", "type": "text", "containerId": "shape"},
        {"id": "arrow", "type": "arrow", "startBinding": {"elementId": "shape"}, "endBinding": None},
    ]
    assert WhiteboardScene.model_validate(empty_scene(elements=elements)).elements == elements


def test_deleted_image_references_remain_authorized_for_undo_and_cannot_cross_boards():
    store = MemoryWhiteboardStore()
    owner = "image-owner"
    first = store.create_board(owner, "First", WhiteboardScene.model_validate(empty_scene()))
    second = store.create_board(owner, "Second", WhiteboardScene.model_validate(empty_scene()))
    store.create_asset(owner, first.board_id, "picture", "image/png", b"\x89PNG\r\n\x1a\n")
    scene = WhiteboardScene.model_validate(empty_scene(
        elements=[{"id": "deleted-image", "type": "image", "fileId": "picture", "isDeleted": True}],
        file_ids=["picture"],
    ))
    saved = store.update_board(owner, first.board_id, "First", scene, expected_revision=1)
    assert saved is not None and saved.scene.elements[0]["isDeleted"] is True
    with pytest.raises(ValueError, match="owner-authorized"):
        store.update_board(owner, second.board_id, "Second", scene, expected_revision=1)
    assert store.get_board(owner, second.board_id).revision == 1


def test_failed_envelope_validation_does_not_mutate_memory_state(monkeypatch):
    import app.whiteboards.contracts as contracts

    store = MemoryWhiteboardStore()
    owner = "bounded-owner"
    board = store.create_board(owner, "Original", WhiteboardScene.model_validate(empty_scene()))
    monkeypatch.setattr(contracts, "MAX_SNAPSHOT_BYTES", 500)
    too_large = WhiteboardScene.model_validate(empty_scene(elements=[{"id": "a", "type": "text", "text": "a" * 500}]))
    with pytest.raises(ValidationError, match="limited to 5 MiB"):
        store.update_board(owner, board.board_id, "Should not save", too_large, expected_revision=1)
    with pytest.raises(ValidationError, match="limited to 5 MiB"):
        store.create_board(owner, "Should not create", too_large)
    assert store.get_board(owner, board.board_id) == board
    assert store.list_boards(owner, limit=10, offset=0)[1] == 1


def test_two_simultaneous_memory_updates_have_one_committed_revision():
    store = MemoryWhiteboardStore()
    owner = "race-owner"
    board = store.create_board(owner, "Board", WhiteboardScene.model_validate(empty_scene()))
    barrier = Barrier(2)

    def save(title):
        barrier.wait(timeout=5)
        try:
            return store.update_board(owner, board.board_id, title, board.scene, expected_revision=1)
        except Conflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(save, ["First tab", "Second tab"]))
    assert outcomes.count("conflict") == 1
    assert store.get_board(owner, board.board_id).revision == 2


def test_api_rejects_invalid_scene_before_creating_a_board_and_preserves_asset_bytes():
    headers = auth()
    assert client.post("/api/whiteboards", headers=headers, json={
        "title": "   ", "scene": empty_scene(),
    }).status_code == 400
    assert client.post("/api/whiteboards", headers=headers, json={
        "title": "Unsafe", "scene": empty_scene(elements=[{"type": "embeddable"}]),
    }).status_code == 400
    board = client.post("/api/whiteboards", headers=headers, json={"title": "Board", "scene": empty_scene()}).json()
    path = f"/api/whiteboards/{board['board_id']}/assets"
    first = client.post(path, headers=headers, json=png_payload()).json()
    assert client.post(path, headers=headers, json=png_payload(data=b"\x89PNG\r\n\x1a\nchanged")).status_code == 409
    restored = client.get(f"{path}/{first['id']}/content", headers=headers)
    assert restored.content == base64.b64decode(png_payload()["data_base64"])
    assert restored.headers["cache-control"] == "private, no-store"
