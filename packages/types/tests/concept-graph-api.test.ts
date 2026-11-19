import { describe, expect, it } from 'vitest';
import { ConceptGraphSchema, ConceptGraphSaveRequestSchema } from '../src/concept-graph-api';

const source = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const graph = {
  version: 1 as const,
  nodes: [
    { id: 'root', label: 'Document', kind: 'root' as const, evidence_ids: ['quote'] },
    { id: 'concept', label: 'Concept', kind: 'objective' as const, objective_id: 'obj-1', evidence_ids: ['quote'] },
  ],
  edges: [{ id: 'edge', source: 'root', target: 'concept', relation: 'supports' as const, evidence_ids: ['quote'] }],
  evidence: [{ id: 'quote', source_document_id: source, chunk_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', chapter_id: null, page: null, kind: 'claim' as const, quote: 'Evidence.' }],
  layout: { root: { x: 2, y: 3 } },
};

describe('saved concept graph contracts', () => {
  it('accepts typed objectives, evidence, relationships and layout', () => {
    expect(ConceptGraphSaveRequestSchema.safeParse({ graph }).success).toBe(true);
  });

  it('rejects duplicate IDs, missing endpoints and oversized imports', () => {
    expect(ConceptGraphSchema.safeParse({ ...graph, nodes: [graph.nodes[0], graph.nodes[0]] }).success).toBe(false);
    expect(ConceptGraphSchema.safeParse({ ...graph, edges: [{ ...graph.edges[0], target: 'missing' }] }).success).toBe(false);
    expect(ConceptGraphSchema.safeParse({ ...graph, layout: { blob: 'x'.repeat(512 * 1024) } }).success).toBe(false);
  });

  it('rejects duplicate typed edges and prerequisite cycles', () => {
    expect(ConceptGraphSchema.safeParse({
      ...graph,
      edges: [graph.edges[0], { ...graph.edges[0], id: 'edge-two' }],
    }).success).toBe(false);
    const cyclic = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: 'other', label: 'Other', kind: 'objective' as const, objective_id: 'obj-2', evidence_ids: ['quote'] },
      ],
      edges: [
        { id: 'a', source: 'concept', target: 'other', relation: 'prerequisite' as const, evidence_ids: [] },
        { id: 'b', source: 'other', target: 'concept', relation: 'prerequisite' as const, evidence_ids: [] },
      ],
    };
    expect(ConceptGraphSchema.safeParse(cyclic).success).toBe(false);
    expect(ConceptGraphSchema.safeParse({
      ...cyclic,
      edges: cyclic.edges.map((edge) => ({ ...edge, relation: 'contains' as const })),
    }).success).toBe(false);
  });
});
