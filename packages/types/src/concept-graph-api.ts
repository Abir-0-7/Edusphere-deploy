import { z } from 'zod';

export const MAX_CONCEPT_GRAPH_NODES = 200;
export const MAX_CONCEPT_GRAPH_EDGES = 500;
export const MAX_CONCEPT_GRAPH_EVIDENCE = 500;
export const MAX_CONCEPT_GRAPH_IMPORT_BYTES = 512 * 1024;

const GraphIdSchema = z.string().trim().min(1).max(120);
const ObjectiveIdSchema = z.string().trim().min(1).max(120);

export const ConceptGraphEvidenceSchema = z.strictObject({
  id: GraphIdSchema,
  source_document_id: z.string().uuid(),
  chunk_id: z.string().uuid(),
  chapter_id: z.string().uuid().nullable().default(null),
  page: z.number().int().min(1).nullable().default(null),
  kind: z.enum(['definition', 'example', 'claim', 'source_quote']),
  quote: z.string().trim().min(1).max(1000),
});

export const ConceptGraphNodeSchema = z.strictObject({
  id: GraphIdSchema,
  label: z.string().trim().min(1).max(200),
  kind: z.enum(['root', 'chapter', 'concept', 'objective']).default('concept'),
  objective_id: ObjectiveIdSchema.nullish(),
  evidence_ids: z.array(GraphIdSchema).max(MAX_CONCEPT_GRAPH_EVIDENCE).default([]),
});

export const ConceptGraphEdgeSchema = z.strictObject({
  id: GraphIdSchema,
  source: GraphIdSchema,
  target: GraphIdSchema,
  relation: z.enum(['contains', 'prerequisite', 'related', 'supports']),
  evidence_ids: z.array(GraphIdSchema).max(MAX_CONCEPT_GRAPH_EVIDENCE).default([]),
});

export const ConceptGraphSchema = z.strictObject({
  version: z.literal(1).default(1),
  nodes: z.array(ConceptGraphNodeSchema).min(2).max(MAX_CONCEPT_GRAPH_NODES),
  edges: z.array(ConceptGraphEdgeSchema).max(MAX_CONCEPT_GRAPH_EDGES),
  evidence: z.array(ConceptGraphEvidenceSchema).max(MAX_CONCEPT_GRAPH_EVIDENCE),
  annotations: z.record(GraphIdSchema, z.string().max(4000)).default({}),
  layout: z.record(z.string(), z.unknown()).default({}),
}).superRefine((graph, context) => {
  const checkUnique = (values: string[], path: string, message: string) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [path], message });
  };
  const nodeIds = graph.nodes.map(({ id }) => id);
  const evidenceIds = graph.evidence.map(({ id }) => id);
  checkUnique(nodeIds, 'nodes', 'node IDs must be unique');
  checkUnique(graph.edges.map(({ id }) => id), 'edges', 'edge IDs must be unique');
  checkUnique(evidenceIds, 'evidence', 'evidence IDs must be unique');
  checkUnique(graph.nodes.flatMap(({ objective_id }) => objective_id ? [objective_id] : []), 'nodes', 'objective IDs must be unique');
  const nodeSet = new Set(nodeIds);
  if (Object.keys(graph.annotations).some((id) => !nodeSet.has(id))) {
    context.addIssue({ code: 'custom', path: ['annotations'], message: 'annotations must reference existing graph nodes' });
  }
  const objectiveNodes = new Set(graph.nodes.filter((node) => node.kind === 'objective').map((node) => node.id));
  const evidenceSet = new Set(evidenceIds);
  const edgeKeys = new Set<string>();
  const prerequisites = new Map<string, string[]>();
  const hierarchy = new Map<string, string[]>();
  graph.edges.forEach((edge, index) => {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) {
      context.addIssue({ code: 'custom', path: ['edges', index], message: 'edge endpoint does not exist' });
    }
    if (edge.source === edge.target) {
      context.addIssue({ code: 'custom', path: ['edges', index], message: 'self edges are not allowed' });
    }
    const key = JSON.stringify([edge.source, edge.target, edge.relation]);
    if (edgeKeys.has(key)) context.addIssue({ code: 'custom', path: ['edges', index], message: 'duplicate typed edge' });
    edgeKeys.add(key);
    checkUnique(edge.evidence_ids, `edges.${index}.evidence_ids`, 'edge evidence IDs must be unique');
    if (edge.evidence_ids.some((id) => !evidenceSet.has(id))) {
      context.addIssue({ code: 'custom', path: ['edges', index, 'evidence_ids'], message: 'edge references unknown evidence' });
    }
    if (edge.relation === 'prerequisite') {
      if (!objectiveNodes.has(edge.source) || !objectiveNodes.has(edge.target)) {
        context.addIssue({ code: 'custom', path: ['edges', index], message: 'prerequisite relationships must connect objective nodes' });
      }
      prerequisites.set(edge.source, [...(prerequisites.get(edge.source) ?? []), edge.target]);
    }
    if (edge.relation === 'contains') {
      hierarchy.set(edge.source, [...(hierarchy.get(edge.source) ?? []), edge.target]);
    }
  });
  graph.nodes.forEach((node, index) => {
    checkUnique(node.evidence_ids, `nodes.${index}.evidence_ids`, 'node evidence IDs must be unique');
    if (node.evidence_ids.some((id) => !evidenceSet.has(id))) {
      context.addIssue({ code: 'custom', path: ['nodes', index, 'evidence_ids'], message: 'node references unknown evidence' });
    }
    if (node.kind === 'objective' && !node.objective_id) {
      context.addIssue({ code: 'custom', path: ['nodes', index, 'objective_id'], message: 'objective nodes require a shared objective ID' });
    }
    if (node.kind !== 'objective' && node.objective_id !== undefined && node.objective_id !== null) {
      context.addIssue({ code: 'custom', path: ['nodes', index, 'objective_id'], message: 'shared objective IDs may only appear on objective nodes' });
    }
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const checkAcyclic = (relations: Map<string, string[]>, message: string) => {
    const visit = (id: string) => {
      if (visiting.has(id)) {
        context.addIssue({ code: 'custom', path: ['edges'], message });
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const target of relations.get(id) ?? []) visit(target);
      visiting.delete(id);
      visited.add(id);
    };
    visiting.clear();
    visited.clear();
    for (const id of nodeIds) visit(id);
  };
  checkAcyclic(prerequisites, 'prerequisite relationships must be acyclic');
  checkAcyclic(hierarchy, 'containment hierarchy must be acyclic');
  if (new TextEncoder().encode(JSON.stringify(graph)).length > MAX_CONCEPT_GRAPH_IMPORT_BYTES) {
    context.addIssue({ code: 'custom', path: [], message: 'concept graph exceeds the 512 KiB import limit' });
  }
});

export const ConceptGraphImportRequestSchema = z.strictObject({
  source_document_id: z.string().uuid(),
  graph: ConceptGraphSchema,
  expected_revision: z.number().int().min(1).nullable().optional(),
});

export const ConceptGraphSaveRequestSchema = z.strictObject({
  graph: ConceptGraphSchema,
  expected_revision: z.number().int().min(1).nullable().optional(),
});

export const ConceptGraphRecordSchema = z.strictObject({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  revision: z.number().int().min(1),
  graph: ConceptGraphSchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const ConceptGraphRegenerateRequestSchema = z.strictObject({
  expected_revision: z.number().int().min(1),
});

export const ConceptGraphNodeActionsSchema = z.strictObject({
  graph_revision: z.number().int().min(1),
  node_id: GraphIdSchema,
  source: z.strictObject({
    document_id: z.string().uuid(),
    chapter_id: z.string().uuid().nullable(),
    chunk_id: z.string().uuid(),
    page: z.number().int().positive().nullable(),
    quote: z.string().min(1).max(1000),
  }).nullable(),
  lesson: z.strictObject({
    enrollment_id: z.string().uuid(),
    course_slug: z.string(),
    lesson_id: z.string(),
    objective_id: z.string().nullable(),
    title: z.string(),
    content: z.string().max(24000),
  }).nullable(),
  deck: z.strictObject({
    document_id: z.string().uuid(),
    deck_id: z.string().uuid(),
    card_ids: z.array(z.string().uuid()).min(1).max(100),
  }).nullable(),
  board: z.strictObject({
    document_id: z.string().uuid(),
    node_id: GraphIdSchema,
    label: z.string().min(1).max(200),
    quote: z.string().min(1).max(1000),
    page: z.number().int().positive().nullable(),
  }).nullable(),
});
export type ConceptGraphNodeActions = z.infer<typeof ConceptGraphNodeActionsSchema>;

export type ConceptGraph = z.infer<typeof ConceptGraphSchema>;
export type ConceptGraphNode = z.infer<typeof ConceptGraphNodeSchema>;
export type ConceptGraphEdge = z.infer<typeof ConceptGraphEdgeSchema>;
export type ConceptGraphEvidence = z.infer<typeof ConceptGraphEvidenceSchema>;
export type ConceptGraphImportRequest = z.infer<typeof ConceptGraphImportRequestSchema>;
export type ConceptGraphSaveRequest = z.infer<typeof ConceptGraphSaveRequestSchema>;
export type ConceptGraphRecord = z.infer<typeof ConceptGraphRecordSchema>;

export const MindMapNodeSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(120),
  kind: z.string().default('concept'),
});
export const MindMapResponseSchema = z.object({
  nodes: z.array(MindMapNodeSchema).min(2),
  edges: z.array(z.object({ source: z.string(), target: z.string(), label: z.string().default('') })).min(1),
});
export type MindMapResponse = z.infer<typeof MindMapResponseSchema>;
export type MindMapNode = z.infer<typeof MindMapNodeSchema>;

export const VivaQuestionSchema = z.object({
  question: z.string().min(3),
  expected_points: z.array(z.string()).min(1),
});
export const VivaQuestionsResponseSchema = z.array(VivaQuestionSchema);
export type VivaQuestion = z.infer<typeof VivaQuestionSchema>;
export const VivaGradeRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(4000),
  expected_points: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
});
export const VivaGradeResponseSchema = z.object({
  score: z.number().int().min(0).max(5),
  feedback: z.string().min(1),
  covered: z.array(z.string()).default([]),
  missed: z.array(z.string()).default([]),
});
export type VivaGradeResponse = z.infer<typeof VivaGradeResponseSchema>;
