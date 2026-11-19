"""Versioned, bounded concept-graph API contracts shared with TypeScript."""

from collections import defaultdict
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

MAX_GRAPH_NODES = 200
MAX_GRAPH_EDGES = 500
MAX_GRAPH_EVIDENCE = 500
MAX_GRAPH_IMPORT_BYTES = 512 * 1024

GraphId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ObjectiveId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class GraphContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConceptGraphEvidence(GraphContract):
    id: GraphId
    source_document_id: UUID
    chunk_id: UUID
    chapter_id: UUID | None = None
    page: Annotated[int, Field(strict=True, ge=1)] | None = None
    kind: Literal["definition", "example", "claim", "source_quote"]
    quote: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class ConceptGraphNode(GraphContract):
    id: GraphId
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    kind: Literal["root", "chapter", "concept", "objective"] = "concept"
    objective_id: ObjectiveId | None = None
    evidence_ids: list[GraphId] = Field(default_factory=list, max_length=MAX_GRAPH_EVIDENCE)


class ConceptGraphEdge(GraphContract):
    id: GraphId
    source: GraphId
    target: GraphId
    relation: Literal["contains", "prerequisite", "related", "supports"]
    evidence_ids: list[GraphId] = Field(default_factory=list, max_length=MAX_GRAPH_EVIDENCE)


class ConceptGraph(GraphContract):
    version: Literal[1] = 1
    nodes: list[ConceptGraphNode] = Field(min_length=2, max_length=MAX_GRAPH_NODES)
    edges: list[ConceptGraphEdge] = Field(max_length=MAX_GRAPH_EDGES)
    evidence: list[ConceptGraphEvidence] = Field(max_length=MAX_GRAPH_EVIDENCE)
    annotations: dict[GraphId, Annotated[str, StringConstraints(max_length=4000)]] = Field(
        default_factory=dict, max_length=MAX_GRAPH_NODES
    )
    layout: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_graph(self) -> "ConceptGraph":
        node_ids = [node.id for node in self.nodes]
        edge_ids = [edge.id for edge in self.edges]
        evidence_ids = [item.id for item in self.evidence]
        objective_ids = [node.objective_id for node in self.nodes if node.objective_id is not None]
        if len(set(node_ids)) != len(node_ids):
            raise ValueError("node IDs must be unique")
        if len(set(edge_ids)) != len(edge_ids):
            raise ValueError("edge IDs must be unique")
        if len(set(evidence_ids)) != len(evidence_ids):
            raise ValueError("evidence IDs must be unique")
        if len(set(objective_ids)) != len(objective_ids):
            raise ValueError("objective IDs must be unique")
        if not self.annotations.keys() <= set(node_ids):
            raise ValueError("annotations must reference existing graph nodes")

        node_set, evidence_set = set(node_ids), set(evidence_ids)
        objective_nodes = {node.id for node in self.nodes if node.kind == "objective"}
        edge_keys: set[tuple[str, str, str]] = set()
        prerequisites: dict[str, list[str]] = defaultdict(list)
        hierarchy: dict[str, list[str]] = defaultdict(list)
        for edge in self.edges:
            if edge.source not in node_set or edge.target not in node_set:
                raise ValueError("edge endpoint does not exist")
            if edge.source == edge.target:
                raise ValueError("self edges are not allowed")
            key = (edge.source, edge.target, edge.relation)
            if key in edge_keys:
                raise ValueError("duplicate typed edge")
            edge_keys.add(key)
            if any(identifier not in evidence_set for identifier in edge.evidence_ids):
                raise ValueError("edge references unknown evidence")
            if len(set(edge.evidence_ids)) != len(edge.evidence_ids):
                raise ValueError("edge evidence IDs must be unique")
            if edge.relation == "prerequisite":
                if edge.source not in objective_nodes or edge.target not in objective_nodes:
                    raise ValueError("prerequisite relationships must connect objective nodes")
                prerequisites[edge.source].append(edge.target)
            elif edge.relation == "contains":
                hierarchy[edge.source].append(edge.target)

        for node in self.nodes:
            if any(identifier not in evidence_set for identifier in node.evidence_ids):
                raise ValueError("node references unknown evidence")
            if len(set(node.evidence_ids)) != len(node.evidence_ids):
                raise ValueError("node evidence IDs must be unique")
            if node.kind == "objective" and node.objective_id is None:
                raise ValueError("objective nodes require a shared objective ID")
            if node.kind != "objective" and node.objective_id is not None:
                raise ValueError("shared objective IDs may only appear on objective nodes")

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(identifier: str, relationships: dict[str, list[str]]) -> None:
            if identifier in visiting:
                raise ValueError("graph hierarchy and prerequisite relationships must be acyclic")
            if identifier in visited:
                return
            visiting.add(identifier)
            for target in relationships.get(identifier, []):
                visit(target, relationships)
            visiting.remove(identifier)
            visited.add(identifier)

        for relationships in (prerequisites, hierarchy):
            visiting.clear()
            visited.clear()
            for identifier in node_ids:
                visit(identifier, relationships)

        if len(self.model_dump_json().encode("utf-8")) > MAX_GRAPH_IMPORT_BYTES:
            raise ValueError("concept graph exceeds the 512 KiB import limit")
        return self


class ConceptGraphSaveRequest(GraphContract):
    graph: ConceptGraph
    expected_revision: Annotated[int, Field(strict=True, ge=1)] | None = None


class ConceptGraphImportRequest(ConceptGraphSaveRequest):
    source_document_id: UUID


class ConceptGraphRecord(GraphContract):
    id: UUID
    document_id: UUID
    revision: Annotated[int, Field(strict=True, ge=1)]
    graph: ConceptGraph
    created_at: str
    updated_at: str


class ConceptGraphRegenerateRequest(GraphContract):
    expected_revision: Annotated[int, Field(strict=True, ge=1)]


class ConceptGraphSourceTarget(GraphContract):
    document_id: UUID
    chapter_id: UUID | None
    chunk_id: UUID
    page: Annotated[int, Field(strict=True, ge=1)] | None
    quote: Annotated[str, StringConstraints(min_length=1, max_length=1000)]


class ConceptGraphLessonTarget(GraphContract):
    enrollment_id: UUID
    course_slug: str
    lesson_id: str
    objective_id: str | None
    title: str
    content: Annotated[str, StringConstraints(max_length=24000)]


class ConceptGraphDeckTarget(GraphContract):
    document_id: UUID
    deck_id: UUID
    card_ids: list[UUID] = Field(min_length=1, max_length=100)


class ConceptGraphBoardTarget(GraphContract):
    document_id: UUID
    node_id: GraphId
    label: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    quote: Annotated[str, StringConstraints(min_length=1, max_length=1000)]
    page: Annotated[int, Field(strict=True, ge=1)] | None


class ConceptGraphNodeActions(GraphContract):
    graph_revision: Annotated[int, Field(strict=True, ge=1)]
    node_id: GraphId
    source: ConceptGraphSourceTarget | None = None
    lesson: ConceptGraphLessonTarget | None = None
    deck: ConceptGraphDeckTarget | None = None
    board: ConceptGraphBoardTarget | None = None
