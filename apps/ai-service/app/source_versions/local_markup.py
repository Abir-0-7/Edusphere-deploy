"""Extract structural text from user-supplied HTML and narrow EPUB 3 containers."""

import io
import posixpath
import re
import stat
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile

from app.errors import InvalidInput, TooLarge

MAX_ARCHIVE_FILES = 64
MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024
MAX_MEMBER_BYTES = 128 * 1024
MAX_SPINE_ITEMS = 16
MAX_COMPRESSION_RATIO = 80
BLOCK_TAGS = frozenset({"article", "blockquote", "div", "li", "p", "section", "h1", "h2", "h3", "h4", "h5", "h6"})
HIDDEN_TAGS = frozenset({"head", "script", "style", "template", "iframe", "svg", "object", "noscript"})
MARKUP_NOTES = (
    "Locators refer to extracted text lines. Image text, styling and interactive content are omitted.",
    "Code indentation and simple table rows are retained. Nested and merged table layout may be flattened.",
)


class _MarkupText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden: list[str] = []
        self.row: list[str] | None = None
        self.cell: list[str] | None = None
        self.pre = False

    def _line(self):
        if self.parts and not self.parts[-1].endswith("\n"):
            self.parts.append("\n")

    def _finish_row(self):
        if self.row is not None:
            if self.cell is not None:
                self._finish_cell()
            self._line()
            self.parts.append("| " + " | ".join(self.row) + " |\n")
        self.row, self.cell = None, None

    def _finish_cell(self):
        if self.cell is not None and self.row is not None:
            value = " ".join("".join(self.cell).split()).replace("|", r"\|")
            self.row.append(value)
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag in HIDDEN_TAGS:
            self.hidden.append(tag)
            return
        if self.hidden:
            return
        if tag in BLOCK_TAGS | {"br", "pre", "table"} and self.cell is None:
            self._line()
        if tag == "pre":
            self.pre = True
        if tag == "tr":
            self._finish_row()
            self.row = []
        if tag in {"td", "th"} and self.row is not None:
            self._finish_cell()
            self.cell = []

    def handle_endtag(self, tag):
        if self.hidden:
            if self.hidden[-1] == tag:
                self.hidden.pop()
            return
        if tag in {"td", "th"}:
            self._finish_cell()
        elif tag in {"tr", "table"}:
            self._finish_row()
        elif tag == "pre":
            self.pre = False
            self._line()
        elif tag in BLOCK_TAGS and self.cell is None:
            self._line()

    def handle_data(self, data):
        if self.hidden:
            return
        if self.cell is not None:
            self.cell.append(data)
        elif self.pre:
            self.parts.append(data)
        elif data.strip() or (self.parts and not self.parts[-1].endswith("\n")):
            self.parts.append(re.sub(r"\s+", " ", data))

    def result(self) -> str:
        self._finish_row()
        return "".join(self.parts).strip("\n")


def _utf8(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise InvalidInput("Local document text must use UTF-8") from exc


def html_text(data: bytes, checkpoint) -> str:
    text = _utf8(data)
    parser = _MarkupText()
    try:
        for offset in range(0, len(text), 4096):
            checkpoint()
            parser.feed(text[offset:offset + 4096])
        parser.close()
    except AssertionError as exc:
        raise InvalidInput("Local HTML contains malformed markup") from exc
    return parser.result()


def _xml(data):
    text = _utf8(data)
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper() or "\x00" in text:
        raise InvalidInput("EPUB package XML uses an unsupported declaration")
    try:
        return ET.fromstring(text)
    except ET.ParseError as exc:
        raise InvalidInput("EPUB package XML is malformed") from exc


def _archive_path(value):
    if not value or any(char in value for char in ("\\", ":", "?", "#", "%")) or any(
        part in {"", ".", ".."} for part in value.split("/")
    ) or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise InvalidInput("EPUB contains an unsupported or unsafe resource path")
    return value


def _members(archive):
    entries = archive.infolist()
    if len(entries) > MAX_ARCHIVE_FILES or sum(item.file_size for item in entries) > MAX_ARCHIVE_EXPANDED_BYTES:
        raise TooLarge("EPUB exceeds archive count or expanded size limits")
    members = {}
    for item in entries:
        name = _archive_path(item.filename.rstrip("/") if item.is_dir() else item.orig_filename)
        if name in members or item.flag_bits & 1 or stat.S_ISLNK(item.external_attr >> 16):
            raise InvalidInput("EPUB contains duplicate, encrypted or linked resources")
        if item.compress_type not in {ZIP_STORED, ZIP_DEFLATED}:
            raise InvalidInput("EPUB uses an unsupported archive compression type")
        if item.file_size > MAX_MEMBER_BYTES or item.file_size > max(item.compress_size, 1) * MAX_COMPRESSION_RATIO:
            raise TooLarge("EPUB resource exceeds size or compression ratio limits")
        members[name] = item
    if "META-INF/encryption.xml" in members:
        raise InvalidInput("Encrypted or DRM-protected EPUB files are unsupported")
    return members


def _read(archive, members, name):
    if name not in members or members[name].is_dir():
        raise InvalidInput("EPUB package refers to a missing resource")
    with archive.open(members[name]) as member:
        data = member.read(MAX_MEMBER_BYTES + 1)
    if len(data) > MAX_MEMBER_BYTES:
        raise TooLarge("EPUB resource exceeds its expanded size limit")
    return data


def epub_text(data: bytes, checkpoint) -> str:
    try:
        with ZipFile(io.BytesIO(data)) as archive:
            members = _members(archive)
            if _read(archive, members, "mimetype") != b"application/epub+zip":
                raise InvalidInput("File does not identify itself as an EPUB")
            container = _xml(_read(archive, members, "META-INF/container.xml"))
            package_refs = container.findall("./{*}rootfiles/{*}rootfile")
            if len(package_refs) != 1:
                raise InvalidInput("EPUB must supply exactly one book package")
            package_path = _archive_path(package_refs[0].get("full-path"))
            package = _xml(_read(archive, members, package_path))
            if package.tag.split("}")[-1] != "package" or not package.get("version", "").startswith("3."):
                raise InvalidInput("This adapter supports EPUB 3 text packages")
            resources = {}
            for item in package.findall("./{*}manifest/{*}item"):
                identifier = item.get("id")
                if not identifier or identifier in resources:
                    raise InvalidInput("EPUB manifest contains missing or duplicate resource IDs")
                resources[identifier] = item
            spine = package.findall("./{*}spine/{*}itemref")
            if not 1 <= len(spine) <= MAX_SPINE_ITEMS:
                raise InvalidInput("EPUB must contain between one and sixteen reading-order chapters")
            parts = []
            for reference in spine:
                checkpoint()
                item = resources.get(reference.get("idref"))
                if item is None or item.get("media-type") not in {"application/xhtml+xml", "text/html"}:
                    raise InvalidInput("EPUB reading order must contain local HTML or XHTML chapters")
                href = _archive_path(item.get("href"))
                path = posixpath.join(posixpath.dirname(package_path), href)
                content = html_text(_read(archive, members, path), checkpoint)
                if content.strip():
                    parts.append(content)
            return "\n\n".join(parts)
    except (BadZipFile, RuntimeError, OSError) as exc:
        raise InvalidInput("EPUB archive is malformed or unsupported") from exc
