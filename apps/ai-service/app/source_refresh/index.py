"""Bounded owner-scoped lookup of persisted references to affected segments."""

import psycopg
from psycopg.rows import dict_row

from app.concept_graph.contracts import ConceptGraph
from app.course_generation.contracts import GenerationRun
from app.course_outlines.contracts import OutlinePlan
from app.courses.contracts import CourseRelease
from app.source_refresh.contracts import ArtifactImpact
from app.source_refresh.impact import fingerprint
from app.source_versions.contracts import PdfLocator, PdfOrigin

SCAN_CAP = 500
PRIORITY = ("removed", "changed", "moved")
LIMITATIONS = (
    "Impact is based on exact source-version pins or existing PDF document and chunk links.",
    "Cards and maps link to PDF chunks. They do not currently store GitHub source pins.",
    "A matching location can suggest a replacement. Review the excerpt before reusing it.",
    "Historical outline approvals and generated drafts retain their original evidence.",
)


def _pin_reason(pin, old, changes):
    if pin.version_id == old.id and pin.content_hash == old.content_hash:
        return changes.get(pin.segment_id)
    return None


def _strongest(reasons):
    present = set(reasons)
    return next((reason for reason in PRIORITY if reason in present), None)


def _artifact(kind, identifier, parent, title, reason, content, *, revision=None, document_id=None, edited=None):
    return ArtifactImpact(
        kind=kind, id=str(identifier), parent_id=str(parent), title=title[:500], reason=reason,
        revision=revision, content_hash=fingerprint(content), document_id=document_id, edited=edited,
    )


def _objectives(kind, plan, parent, revision, old, changes, edited=None):
    for objective in plan.objectives:
        reason = _strongest(_pin_reason(pin, old, changes) for pin in objective.evidence)
        if reason:
            yield _artifact(
                kind, objective.id, parent, objective.title, reason, objective.model_dump(mode="json"),
                revision=revision, edited=None if edited is None else objective.id in edited,
            )


def _lessons(release, old, changes):
    pinned = {item.id: item.source_pin for item in release.evidence if item.source_pin is not None}
    exercises = {item.id: item for item in release.exercises}
    for lesson in release.lessons:
        linked = {identifier for block in lesson.blocks for identifier in block.evidence_ids}
        for exercise_id in (*lesson.practice_ids, *lesson.checkpoint_ids):
            linked.update(exercises[exercise_id].evidence_ids)
        reason = _strongest(_pin_reason(pinned[i], old, changes) for i in linked if i in pinned)
        if reason:
            yield _artifact(
                "course_lesson", lesson.id, release.id, lesson.title, reason, lesson.model_dump(mode="json"),
            )


def _changed_chunks(old, changes):
    return {
        segment.locator.chunk_id: changes[segment.id]
        for segment in old.snapshot.segments if isinstance(segment.locator, PdfLocator) and segment.id in changes
    }


def _card_impact(card, document, reason):
    content = {key: card.get(key) for key in ("front", "back", "source_revision", "source_chunk_id")}
    return _artifact("card", card["id"], document, card["front"] or "Flashcard", reason, content, document_id=document)


def _map_impacts(graph, document, revision, changed_chunks):
    reasons = {
        item.id: changed_chunks.get(item.chunk_id)
        for item in graph.evidence if item.source_document_id == document
    }
    for kind, items in (("map_node", graph.nodes), ("map_edge", graph.edges)):
        for item in items:
            reason = _strongest(reasons.get(identifier) for identifier in item.evidence_ids)
            if reason:
                yield _artifact(
                    kind, item.id, document, item.label if kind == "map_node" else item.relation, reason,
                    item.model_dump(mode="json"), revision=revision, document_id=document,
                )


class _Scan:
    def __init__(self):
        self.truncated = False
        self.out = {}

    def take(self, rows):
        self.truncated |= len(rows) > SCAN_CAP
        return rows[:SCAN_CAP]

    def add(self, values):
        for item in values:
            self.out[(item.kind, item.parent_id, item.id, item.revision or 0)] = item

    def result(self):
        limitations = list(LIMITATIONS)
        if self.truncated:
            limitations.append(f"Only the first {SCAN_CAP} candidate records in each scan are counted.")
        return [self.out[key] for key in sorted(self.out)], self.truncated, limitations


class MemoryImpactIndex:
    def __init__(self, documents, outline_store, generation_store, graph_store, course_store, edit_store):
        self.documents, self.outlines, self.generations = documents, outline_store, generation_store
        self.graphs, self.courses, self.edits = graph_store, course_store, edit_store

    def artifacts(self, user_id, old, changes):
        scan = _Scan()
        if not changes:
            return scan.result()

        with self.outlines._lock, self.generations._lock, self.edits._lock:
            outlines = sorted(
                (identifier, row) for identifier, row in self.outlines._rows.items()
                if row.owner == user_id and str(old.id) in row.sources
            )
            for identifier, row in scan.take(outlines):
                scan.add(_objectives("outline_objective", row.plan, identifier, row.revision, old, changes))
            approvals = [(identifier, approval) for identifier, row in outlines for approval in row.approvals]
            for identifier, approval in scan.take(approvals):
                scan.add(_objectives(
                    "outline_objective", approval.snapshot.plan, identifier, approval.revision, old, changes,
                ))
            runs = sorted(
                (identifier, run) for identifier, (owner, run) in self.generations._rows.items()
                if owner == user_id and any(source.version_id == old.id for source in run.plan.sources)
            )
            for identifier, run in scan.take(runs):
                edited = {entry.objective_id for entry in self.edits._history(user_id, identifier)}
                scan.add(_objectives("generated_lesson", run.plan, run.id, run.revision, old, changes, edited))

        with self.courses._lock:
            releases = sorted(
                (identifier, release) for identifier, release in self.courses._releases.items()
                if release.user_id == user_id
            )
            for _, release in scan.take(releases):
                scan.add(_lessons(release, old, changes))

        origin = old.snapshot.origin
        changed_chunks = {str(chunk): reason for chunk, reason in _changed_chunks(old, changes).items()}
        if isinstance(origin, PdfOrigin) and changed_chunks:
            document = origin.document_id
            # A preview must never initialize an old card's history as a side effect.
            with self.documents._lock:
                cards = sorted(
                    (card for card in self.documents._flashcards.get((str(document), user_id), [])
                     if str(card.get("source_chunk_id")) in changed_chunks),
                    key=lambda card: str(card["id"]),
                )
                scan.add(
                    _card_impact(card, document, changed_chunks[str(card["source_chunk_id"])])
                    for card in scan.take(cards)
                )
            record = self.graphs.get(user_id, str(document))
            if record:
                scan.add(_map_impacts(record.graph, document, record.revision, _changed_chunks(old, changes)))
        return scan.result()


class PgImpactIndex:
    def __init__(self, database_url, *, timeout_seconds=5):
        self.database_url, self.timeout_seconds = database_url, timeout_seconds

    def artifacts(self, user_id, old, changes):
        scan = _Scan()
        if not changes:
            return scan.result()
        limit = SCAN_CAP + 1
        with psycopg.connect(self.database_url, row_factory=dict_row, connect_timeout=5) as conn:
            millis = max(1, int(self.timeout_seconds * 1000))
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            conn.execute("SELECT set_config('statement_timeout',%s,true)", (f"{millis}ms",))
            rows = conn.execute(
                "SELECT o.id,o.revision,o.plan FROM course_outlines o JOIN course_outline_sources s "
                "ON o.id=s.outline_id AND o.user_id=s.user_id WHERE s.user_id=%s AND s.source_version_id=%s "
                "ORDER BY o.id LIMIT %s", (user_id, old.id, limit),
            ).fetchall()
            for row in scan.take(rows):
                scan.add(_objectives(
                    "outline_objective", OutlinePlan.model_validate(row["plan"]),
                    row["id"], row["revision"], old, changes,
                ))
            rows = conn.execute(
                "SELECT a.outline_id,a.revision,a.snapshot FROM course_outline_approvals a "
                "JOIN course_outline_sources s "
                "ON a.outline_id=s.outline_id AND a.user_id=s.user_id WHERE s.user_id=%s AND s.source_version_id=%s "
                "ORDER BY a.outline_id,a.revision LIMIT %s", (user_id, old.id, limit),
            ).fetchall()
            for row in scan.take(rows):
                scan.add(_objectives(
                    "outline_objective", OutlinePlan.model_validate(row["snapshot"]["plan"]),
                    row["outline_id"], row["revision"], old, changes,
                ))
            rows = conn.execute(
                "SELECT g.state,ARRAY(SELECT DISTINCT e.objective_id FROM course_generation_lesson_edits e "
                "WHERE e.user_id=g.user_id AND e.run_id=g.id) AS edited "
                "FROM course_generation_runs g JOIN course_outline_sources s "
                "ON g.outline_id=s.outline_id AND g.user_id=s.user_id WHERE s.user_id=%s AND s.source_version_id=%s "
                "ORDER BY g.id LIMIT %s", (user_id, old.id, limit),
            ).fetchall()
            for row in scan.take(rows):
                run = GenerationRun.model_validate(row["state"])
                scan.add(_objectives("generated_lesson", run.plan, run.id, run.revision, old, changes, row["edited"]))
            rows = conn.execute(
                "SELECT r.content FROM course_releases r JOIN courses c ON c.id=r.course_id "
                "WHERE r.user_id=%s AND c.user_id=%s ORDER BY r.id LIMIT %s", (user_id, user_id, limit),
            ).fetchall()
            for row in scan.take(rows):
                scan.add(_lessons(CourseRelease.model_validate(row["content"]), old, changes))
            origin = old.snapshot.origin
            changed_chunks = _changed_chunks(old, changes)
            if isinstance(origin, PdfOrigin) and changed_chunks:
                document = origin.document_id
                rows = conn.execute(
                    "SELECT id,front,back,source_revision,source_chunk_id FROM flashcards "
                    "WHERE user_id=%s AND document_id=%s AND source_chunk_id=ANY(%s) ORDER BY id LIMIT %s",
                    (user_id, document, list(changed_chunks), limit),
                ).fetchall()
                scan.add(_card_impact(card, document, changed_chunks[card["source_chunk_id"]])
                         for card in scan.take(rows))
                row = conn.execute(
                    "SELECT revision,graph FROM concept_graphs WHERE user_id=%s AND document_id=%s",
                    (user_id, document),
                ).fetchone()
                if row:
                    scan.add(_map_impacts(
                        ConceptGraph.model_validate(row["graph"]), document, row["revision"], changed_chunks,
                    ))
        return scan.result()
