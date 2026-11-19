"""Bounded comparison without semantic rebinding."""

import hashlib
import json
from collections import Counter, defaultdict

from app.errors import InvalidInput
from app.source_refresh.contracts import SegmentChange, SegmentCounts
from app.source_versions.contracts import GithubOrigin, PdfLocator, SourceVersion, TextLocator, TextOrigin


def fingerprint(value):
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, ensure_ascii=False, default=str, separators=(",", ":"),
    ).encode()).hexdigest()


def _positions(segments):
    page_ordinals = Counter()
    positions = {}
    for segment in segments:
        location = segment.locator
        if isinstance(location, PdfLocator):
            page_ordinals[location.pdf_page_index] += 1
            position = ("pdf", location.pdf_page_index, page_ordinals[location.pdf_page_index])
        elif isinstance(location, TextLocator):
            position = ("text", location.start_line, location.end_line)
        else:
            cell = location.notebook_cell
            position = (
                "github", location.path, location.start_line, location.end_line,
                cell.index if cell else None, cell.cell_type if cell else None,
            )
        positions[segment.id] = position
    return positions


def _pair_unique(before, after, matches, consumed, before_key, after_key):
    old_groups, new_groups = defaultdict(list), defaultdict(list)
    for segment in before:
        if segment.id not in matches:
            old_groups[before_key(segment)].append(segment)
    for segment in after:
        if segment.id not in consumed:
            new_groups[after_key(segment)].append(segment)
    for key, old_group in old_groups.items():
        new_group = new_groups.get(key, [])
        if len(old_group) == len(new_group) == 1:
            matches[old_group[0].id] = new_group[0]
            consumed.add(new_group[0].id)


def compare_segments(old: SourceVersion, new: SourceVersion) -> tuple[list[SegmentChange], SegmentCounts]:
    first, second = old.snapshot.origin, new.snapshot.origin
    if first.kind != second.kind:
        raise InvalidInput("Compare prepared versions from the same source adapter")
    if isinstance(first, GithubOrigin) and isinstance(second, GithubOrigin):
        if (first.owner.casefold(), first.repository.casefold()) != (
            second.owner.casefold(), second.repository.casefold()
        ):
            raise InvalidInput("Repository impact comparison requires the same GitHub repository")
    if isinstance(first, TextOrigin) and isinstance(second, TextOrigin):
        if (first.format, old.snapshot.title) != (second.format, new.snapshot.title):
            raise InvalidInput("Compare local text versions with the same title and input format")

    before, after = old.snapshot.segments, new.snapshot.segments
    old_positions, new_positions = _positions(before), _positions(after)
    matches, consumed = {}, set()

    # Reserve identities before comparing replacement chunks. Prefer unique
    # identical text over structural matches so insertions do not cascade into
    # incorrect changes on later chunks. Location-only matches are advisory.
    # GitHub IDs are locator-derived, so exact text takes precedence there.
    if isinstance(first, (GithubOrigin, TextOrigin)):
        _pair_unique(before, after, matches, consumed,
                     lambda item: item.text_sha256, lambda item: item.text_sha256)
    _pair_unique(before, after, matches, consumed, lambda item: item.id, lambda item: item.id)
    _pair_unique(before, after, matches, consumed,
                 lambda item: item.text_sha256, lambda item: item.text_sha256)
    _pair_unique(before, after, matches, consumed,
                 lambda item: old_positions[item.id], lambda item: new_positions[item.id])

    changes = []
    for segment in before:
        candidate = matches.get(segment.id)
        if candidate is None:
            kind = "removed"
        elif segment.text != candidate.text:
            kind = "changed"
        elif segment.locator != candidate.locator or segment.id != candidate.id:
            kind = "moved"
        else:
            kind = "unchanged"
        changes.append(SegmentChange(
            change=kind, old_segment_id=segment.id, new_segment_id=candidate.id if candidate else None,
            old_locator=segment.locator, new_locator=candidate.locator if candidate else None,
            old_excerpt=segment.text[:500], new_excerpt=candidate.text[:500] if candidate else None,
        ))
    changes.extend(
        SegmentChange(change="added", new_segment_id=segment.id, new_locator=segment.locator,
                      new_excerpt=segment.text[:500])
        for segment in after if segment.id not in consumed
    )
    totals = Counter(item.change for item in changes)
    return changes, SegmentCounts(**{
        name: totals[name] for name in ("unchanged", "changed", "moved", "removed", "added")
    })
