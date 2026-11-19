"""Deterministic linked coverage; semantic support/conflicts require human review."""

from app.course_outlines.contracts import ObjectiveCoverage, OutlineCoverage, OutlinePlan
from app.errors import Conflict, NotFound
from app.source_versions.service import resolve_version


def analyze_plan(user_id: str, plan: OutlinePlan, source_versions, *, conn=None) -> OutlineCoverage:
    versions = {}
    for source in sorted(plan.sources, key=lambda item: str(item.version_id)):
        identifier = str(source.version_id)
        version = (
            source_versions.get(user_id, identifier) if conn is None
            else source_versions.get_locked(user_id, identifier, conn)
        )
        if version is None:
            raise NotFound("Selected source version not found")
        if version.content_hash != source.content_hash:
            raise Conflict("Selected source hash does not match its immutable version")
        versions[source.version_id] = version
    for objective in plan.objectives:
        for pin in objective.evidence:
            resolve_version(versions[pin.version_id], pin)
    return describe_plan(plan)


def describe_plan(plan: OutlinePlan) -> OutlineCoverage:
    """Describe a validated saved plan; immutable-source existence is checked by its store.

    This avoids reading megabytes of already-verified source text for list/read
    requests. Creates, edits and approvals still call analyze_plan before writing.
    """
    objectives, used, gaps, overlaps, unreviewed = [], set(), [], [], []
    for objective in plan.objectives:
        source_ids = sorted({pin.version_id for pin in objective.evidence}, key=str)
        used.update(source_ids)
        status = "gap" if not source_ids else "overlap" if len(source_ids) > 1 else "linked"
        if status == "gap":
            gaps.append(objective.id)
        if status == "overlap":
            overlaps.append(objective.id)
        if objective.review_status != "reviewed":
            unreviewed.append(objective.id)
        objectives.append(ObjectiveCoverage(
            objective_id=objective.id, status=status, source_version_ids=source_ids,
            evidence_count=len(objective.evidence), reviewed=objective.review_status == "reviewed",
        ))
    assigned = {identifier for module in plan.modules for identifier in module.objective_ids}
    unmapped = [objective.id for objective in plan.objectives if objective.id not in assigned]
    ordered = {identifier: index for index, identifier in enumerate(
        identifier for module in plan.modules for identifier in module.objective_ids
    )}
    misordered = [objective.id for objective in plan.objectives if objective.id in ordered and any(
        parent in ordered and ordered[parent] >= ordered[objective.id] for parent in objective.prerequisite_ids
    )]
    conflicts = [item.id for item in plan.conflicts if item.resolution is None]
    return OutlineCoverage(
        objectives=objectives, gap_objective_ids=gaps, overlap_objective_ids=overlaps,
        unreviewed_objective_ids=unreviewed, unmapped_objective_ids=unmapped,
        misordered_objective_ids=misordered,
        unused_source_version_ids=[source.version_id for source in plan.sources if source.version_id not in used],
        unresolved_conflict_ids=conflicts,
        estimated_minutes=sum(objective.estimated_minutes for objective in plan.objectives),
        ready_for_approval=not (gaps or unreviewed or unmapped or misordered or conflicts),
    )
