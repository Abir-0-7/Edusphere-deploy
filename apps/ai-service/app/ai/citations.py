"""Citation formatter (task 4.9): APA, MLA and IEEE from document metadata.

Pure functions, unit tested — no LLM involved, so citations stay deterministic.
"""

import re
from dataclasses import dataclass, field


@dataclass
class SourceMeta:
    authors: list[str] = field(default_factory=list)
    title: str = ""
    year: str = ""
    container: str = ""
    url: str = ""
    accessed: str = ""
    pages: str = ""


def _surname(author: str) -> tuple[str, str]:
    parts = [p for p in re.split(r"\s+", author.strip()) if p]
    if not parts:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    return (parts[-1], " ".join(parts[:-1]))


def _initials(given: str) -> str:
    return " ".join(f"{p[0]}." for p in re.findall(r"[A-Za-z][A-Za-z'-]*", given))


def format_apa(meta: SourceMeta) -> str:
    names = []
    for author in meta.authors:
        surname, given = _surname(author)
        names.append(f"{surname}, {_initials(given)}".strip().rstrip(","))

    if not names:
        authors = ""
    elif len(names) == 1:
        authors = names[0]
    else:
        authors = ", ".join(names[:-1]) + ", & " + names[-1]

    parts: list[str] = []
    if authors:
        # `authors` may already end in an initial ("Lovelace, A."); one dot only.
        parts.append(authors if authors.endswith(".") else f"{authors}.")
    parts.append(f"({meta.year})." if meta.year else "(n.d.).")
    if meta.title:
        parts.append(f"{meta.title}.")
    if meta.container and meta.pages:
        parts.append(f"{meta.container}, {meta.pages}.")
    elif meta.container:
        parts.append(f"{meta.container}.")
    elif meta.pages:
        parts.append(f"{meta.pages}.")
    if meta.url:
        parts.append(meta.url)
    return " ".join(parts)


def format_mla(meta: SourceMeta) -> str:
    if not meta.authors:
        authors = ""
    elif len(meta.authors) == 1:
        surname, given = _surname(meta.authors[0])
        authors = f"{surname}, {given}. "
    else:
        surname, given = _surname(meta.authors[0])
        authors = f"{surname}, {given}, et al. "
    title = f'"{meta.title}." ' if meta.title else ""
    container = f"{meta.container}, " if meta.container else ""
    year = f"{meta.year}, " if meta.year else ""
    pages = f"{meta.pages}, " if meta.pages else ""
    url = f"{meta.url}." if meta.url else ""
    # MLA: "Container, year, pages, url." (volume/issue omit here).
    tail = f"{container}{year}{pages}{url}".strip().rstrip(",")
    return f"{authors}{title}{tail}.".replace(" .", ".").replace("..", ".").strip()


def format_ieee(meta: SourceMeta) -> str:
    names = []
    for author in meta.authors:
        surname, given = _surname(author)
        initials = _initials(given)
        names.append(f"{initials} {surname}".strip())
    if not names:
        authors = ""
    elif len(names) == 1:
        authors = names[0]
    elif len(names) == 2:
        authors = f"{names[0]} and {names[1]}"
    else:
        authors = ", ".join(names[:-1]) + f", and {names[-1]}"
    title = f'"{meta.title}," ' if meta.title else ""
    container = f"{meta.container}, " if meta.container else ""
    pages = f"{meta.pages}, " if meta.pages else ""
    year = f"{meta.year}" if meta.year else "n.d."
    url = f", {meta.url}" if meta.url else ""
    body = f"{title}{container}{pages}{year}{url}".strip().rstrip(",")
    return f"{authors}, {body}." if authors else f"{body}."


FORMATTERS = {"apa": format_apa, "mla": format_mla, "ieee": format_ieee}


def format_citation(meta: SourceMeta, style: str) -> str:
    formatter = FORMATTERS.get(style.lower())
    if formatter is None:
        raise ValueError(f"unsupported style {style!r}; use apa, mla or ieee")
    return formatter(meta)
