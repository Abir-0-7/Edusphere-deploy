"""Versioned StudyVault whiteboard wire contracts and asset bounds."""

import base64
import binascii
import hashlib
import math
import re
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints, field_validator, model_validator

MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024
MAX_ELEMENTS = 10_000
MAX_ASSETS = 200
MAX_ASSET_BYTES = 10 * 1024 * 1024
MAX_BOARD_ASSET_BYTES = 50 * 1024 * 1024
MAX_DEPTH = 32
MAX_STRING_BYTES = 100 * 1024
MAX_TITLE_CHARS = 200
MAX_FILE_ID_CHARS = 160
FILE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,160}$")
ELEMENT_TYPES = {
    "selection", "rectangle", "diamond", "ellipse", "line", "arrow",
    "freedraw", "text", "image", "frame", "magicframe",
}


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _validate_tree(value: Any, *, depth: int = 0, path: str = "scene") -> None:
    if depth > MAX_DEPTH:
        raise ValueError(f"{path} exceeds the maximum JSON nesting depth")
    if isinstance(value, str):
        if len(value.encode("utf-8")) > MAX_STRING_BYTES:
            raise ValueError(f"{path} contains a string over the size limit")
        return
    if isinstance(value, list):
        if len(value) > 20_000:
            raise ValueError(f"{path} contains too many array items")
        for index, child in enumerate(value):
            _validate_tree(child, depth=depth + 1, path=f"{path}.{index}")
    elif isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or len(key) > MAX_FILE_ID_CHARS:
                raise ValueError(f"{path} contains an invalid object key")
            if key in {"__proto__", "constructor", "prototype"}:
                raise ValueError(f"{path} contains a forbidden object key")
            if key in {"src", "dataURL", "fileData"} and isinstance(child, str):
                if child.lower().startswith(("http:", "https:", "data:", "blob:")):
                    raise ValueError(f"{path}.{key} must use an owner-authorized asset ID")
            _validate_tree(child, depth=depth + 1, path=f"{path}.{key}")
    elif value is not None and not isinstance(value, (str, bool, int, float)):
        raise ValueError(f"{path} must contain only JSON values")
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{path} contains a non-finite number")


class WhiteboardScene(Contract):
    elements: list[dict[str, Any]] = Field(max_length=MAX_ELEMENTS)
    app_state: dict[str, Any]
    file_ids: list[Annotated[str, Field(min_length=1, max_length=MAX_FILE_ID_CHARS)]] = Field(max_length=MAX_ASSETS)

    @field_validator("app_state")
    @classmethod
    def validate_app_state(cls, value: dict[str, Any]) -> dict[str, Any]:
        allowed = {"viewBackgroundColor", "gridSize", "zoom", "scrollX", "scrollY"}
        if value.keys() - allowed:
            raise ValueError("unsupported whiteboard app state field")
        if "viewBackgroundColor" in value:
            color = value["viewBackgroundColor"]
            if not isinstance(color, str) or len(color) > 32:
                raise ValueError("invalid whiteboard background color")
        for key, minimum, maximum in (
            ("gridSize", 0, 512), ("zoom", 0.1, 10),
            ("scrollX", -1_000_000, 1_000_000), ("scrollY", -1_000_000, 1_000_000),
        ):
            if key not in value or (key == "gridSize" and value[key] is None):
                continue
            number = value[key]
            if type(number) not in (int, float) or not minimum <= number <= maximum:
                raise ValueError(f"invalid whiteboard {key}")
        return value

    @model_validator(mode="after")
    def validate_content(self):
        ids: set[str] = set()
        for index, element in enumerate(self.elements):
            kind = element.get("type")
            if not isinstance(kind, str) or kind not in ELEMENT_TYPES:
                raise ValueError(f"scene.elements.{index} contains an unsupported element type")
            element_id = element.get("id")
            if not isinstance(element_id, str) or not 1 <= len(element_id) <= MAX_FILE_ID_CHARS:
                raise ValueError("whiteboard elements require bounded nonempty string IDs")
            if element_id in ids:
                raise ValueError("whiteboard element IDs must be unique")
            ids.add(element_id)
        for element in self.elements:
            for key in ("containerId", "frameId"):
                reference = element.get(key)
                if reference is not None and (not isinstance(reference, str) or reference not in ids):
                    raise ValueError(f"whiteboard {key} must reference an element in the same scene")
            for key in ("startBinding", "endBinding"):
                binding = element.get(key)
                if binding is not None and (
                    not isinstance(binding, dict) or not isinstance(binding.get("elementId"), str)
                    or binding["elementId"] not in ids
                ):
                    raise ValueError(f"whiteboard {key} must reference an element in the same scene")
            bound = element.get("boundElements")
            if bound is not None and (not isinstance(bound, list) or any(
                not isinstance(item, dict) or not isinstance(item.get("id"), str) or item["id"] not in ids
                for item in bound
            )):
                raise ValueError("whiteboard boundElements must reference elements in the same scene")
        if len(set(self.file_ids)) != len(self.file_ids):
            raise ValueError("whiteboard file IDs must be unique")
        if any(not FILE_ID_PATTERN.fullmatch(file_id) for file_id in self.file_ids):
            raise ValueError("whiteboard file IDs must contain only ASCII letters, digits, underscores, or hyphens")
        image_ids: set[str] = set()
        for element in self.elements:
            if element.get("type") == "image":
                file_id = element.get("fileId")
                if not isinstance(file_id, str) or not FILE_ID_PATTERN.fullmatch(file_id):
                    raise ValueError("whiteboard images must reference an authorized file ID")
                image_ids.add(file_id)
        if image_ids != set(self.file_ids):
            raise ValueError("whiteboard image references must match scene file IDs, including deleted images for undo")
        _validate_tree({"elements": self.elements, "app_state": self.app_state})
        return self


class WhiteboardCreateRequest(Contract):
    title: Annotated[str, Field(min_length=1, max_length=MAX_TITLE_CHARS)]
    scene: WhiteboardScene

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("whiteboard title must not be blank")
        return value.strip()


class WhiteboardUpdateRequest(WhiteboardCreateRequest):
    expected_revision: Annotated[int, Field(ge=1)]


class WhiteboardSnapshot(Contract):
    format: Literal["studyvault-whiteboard"] = "studyvault-whiteboard"
    schema_version: Literal[1] = 1
    board_id: UUID
    title: Annotated[str, Field(min_length=1, max_length=MAX_TITLE_CHARS)]
    revision: Annotated[int, Field(ge=1)]
    updated_at: datetime
    renderer: dict[str, str]
    scene: WhiteboardScene

    @field_validator("renderer")
    @classmethod
    def validate_renderer(cls, renderer: dict[str, str]) -> dict[str, str]:
        if renderer != {"id": "excalidraw", "version": "0.18.1"}:
            raise ValueError("unsupported whiteboard renderer or version")
        return renderer

    @model_validator(mode="after")
    def validate_serialized_size(self):
        size = len(self.model_dump_json().encode("utf-8"))
        if size > MAX_SNAPSHOT_BYTES:
            raise ValueError("whiteboard snapshot is limited to 5 MiB")
        return self


class WhiteboardListResponse(Contract):
    items: list[WhiteboardSnapshot] = Field(max_length=100)
    limit: Annotated[int, Field(ge=1, le=100)]
    offset: Annotated[int, Field(ge=0)]
    total_count: Annotated[int, Field(ge=0)]


class WhiteboardDeleteResponse(Contract):
    id: UUID
    deleted: Literal[True] = True


BoardLearningAction = Literal["tutor", "cards", "map"]
BoardShapeId = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=160)]
BoardExcerptIds = Annotated[list[BoardShapeId], Field(min_length=1, max_length=20)]
BoardTutorQuestion = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=240)]
BoardTutorAnswer = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=1200)]


class BoardLearningRequest(Contract):
    revision: Annotated[StrictInt, Field(ge=1)]
    shape_ids: BoardExcerptIds
    action: BoardLearningAction
    question: BoardTutorQuestion | None = None

    @model_validator(mode="after")
    def valid_selection(self):
        if len(set(self.shape_ids)) != len(self.shape_ids) or any(not value.strip() for value in self.shape_ids):
            raise ValueError("Selection shape IDs must be unique and nonblank")
        if (self.action == "tutor") != (self.question is not None):
            raise ValueError("Provide a question only for a tutor preview")
        return self


class BoardLearningExcerpt(Contract):
    id: BoardShapeId
    text: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=600)]


class BoardLearningCard(Contract):
    front: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=220)]
    back: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=700)]
    excerpt_ids: BoardExcerptIds


class BoardLearningNode(Contract):
    label: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=180)]
    excerpt_ids: BoardExcerptIds


class BoardLearningDraft(Contract):
    answer: BoardTutorAnswer | None = None
    answer_excerpt_ids: list[BoardShapeId] = Field(default_factory=list, max_length=20)
    cards: list[BoardLearningCard] = Field(default_factory=list, max_length=5)
    nodes: list[BoardLearningNode] = Field(default_factory=list, max_length=5)


class BoardLearningPreview(BoardLearningDraft):
    board_id: UUID
    revision: Annotated[StrictInt, Field(ge=1)]
    action: BoardLearningAction
    excerpts: list[BoardLearningExcerpt] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def grounded_shape(self):
        populated = set()
        if self.answer is not None or self.answer_excerpt_ids:
            if self.answer is None or not self.answer_excerpt_ids:
                raise ValueError("A tutor answer must cite its selected excerpts")
            populated.add("tutor")
        if self.cards:
            populated.add("cards")
        if self.nodes:
            populated.add("map")
        if populated != {self.action}:
            raise ValueError("Preview must contain the requested learning action only")
        ids = {excerpt.id for excerpt in self.excerpts}
        refs = [self.answer_excerpt_ids, *(item.excerpt_ids for item in [*self.cards, *self.nodes])]
        if len(ids) != len(self.excerpts) or any(
            len(set(group)) != len(group) or not set(group) <= ids for group in refs
        ):
            raise ValueError("Preview references must identify selected excerpts exactly")
        return self


class WhiteboardAssetUpload(Contract):
    file_id: Annotated[str, Field(min_length=1, max_length=MAX_FILE_ID_CHARS)]
    mime_type: Literal["image/png", "image/jpeg", "image/webp"]
    data_base64: Annotated[str, Field(min_length=4, max_length=((MAX_ASSET_BYTES + 2) // 3) * 4 + 4)]

    @field_validator("file_id")
    @classmethod
    def validate_file_id(cls, value: str) -> str:
        if not FILE_ID_PATTERN.fullmatch(value):
            raise ValueError("file_id must contain only ASCII letters, digits, underscores, or hyphens")
        return value

    def decode_asset(self) -> bytes:
        try:
            data = base64.b64decode(self.data_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("asset data must be valid base64") from exc
        if not data or len(data) > MAX_ASSET_BYTES:
            raise ValueError("each whiteboard image must be between 1 byte and 10 MiB")
        if not _matches_mime(data, self.mime_type):
            raise ValueError("asset bytes do not match the declared PNG, JPEG or WebP type")
        return data


def _matches_mime(data: bytes, mime_type: str) -> bool:
    if mime_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9")
    return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


class WhiteboardAssetResponse(Contract):
    id: UUID
    file_id: str
    mime_type: Literal["image/png", "image/jpeg", "image/webp"]
    size_bytes: Annotated[int, Field(ge=1, le=MAX_ASSET_BYTES)]
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    created_at: datetime


class WhiteboardAssetListResponse(Contract):
    assets: list[WhiteboardAssetResponse] = Field(max_length=MAX_ASSETS)


class WhiteboardAssetDeleteResponse(Contract):
    id: UUID
    deleted: Literal[True] = True


def asset_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
