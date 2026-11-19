import { describe, expect, it } from 'vitest';
import type { ConceptGraph } from '@studyvault/types';
import { layoutConceptGraph, normalizeMindMap, renderConceptGraphSvg, serializeConceptGraph, wrapGraphLabel } from '../src/lib/concept-graph';

function graphFixture(): ConceptGraph {
  const nodes: ConceptGraph['nodes'] = [{ id: 'root', label: 'Concept map root label is intentionally much longer than one visual line.', kind: 'root', objective_id: null, evidence_ids: [] }];
  const edges: ConceptGraph['edges'] = [];
  for (let branch = 0; branch < 5; branch += 1) {
    const branchId = `branch-${branch}`;
    nodes.push({ id: branchId, label: `Chapter branch ${branch}`, kind: 'chapter', objective_id: null, evidence_ids: [] });
    edges.push({ id: `contains-root-${branch}`, source: 'root', target: branchId, relation: 'contains', evidence_ids: [] });
    for (let leaf = 0; leaf < (branch === 4 ? 8 : 9); leaf += 1) {
      const id = `node-${branch}-${leaf}`;
      nodes.push({ id, label: `Full label for concept ${branch}-${leaf} with complete visible text`, kind: 'concept', objective_id: null, evidence_ids: [] });
      edges.push({ id: `contains-${branch}-${leaf}`, source: branchId, target: id, relation: 'contains', evidence_ids: [] });
    }
  }
  edges.push({ id: 'cross-link', source: 'node-0-0', target: 'node-4-7', relation: 'related', evidence_ids: [] });
  return { version: 1, nodes, edges, evidence: [], annotations: {}, layout: {} };
}

describe('concept graph layout and exports', () => {
  it('normalizes generated maps to stable typed hierarchy and cross-link relations', () => {
    const normalized = normalizeMindMap({
      nodes: [
        { id: 'root', label: 'Document', kind: 'root' },
        { id: 'chapter', label: 'Chapter', kind: 'chapter' },
        { id: 'concept', label: 'Concept', kind: 'concept' },
      ],
      edges: [
        { source: 'root', target: 'chapter', label: '' },
        { source: 'chapter', target: 'concept', label: '' },
        { source: 'root', target: 'concept', label: 'cross link' },
      ],
    });
    expect(normalized.edges.map(({ relation }) => relation)).toEqual(['contains', 'contains', 'related']);
  });

  it('keeps every label in the keyboard outline and export for a 50-node graph', () => {
    const graph = graphFixture();
    const layout = layoutConceptGraph(graph);
    const svg = renderConceptGraphSvg(graph);
    const json = serializeConceptGraph(graph);
    expect(graph.nodes).toHaveLength(50);
    expect(layout.visibleIds.size).toBe(50);
    expect(layout.positions.size).toBe(50);
    for (const node of graph.nodes) {
      expect(svg).toContain(node.label.replaceAll('&', '&amp;'));
      expect(json).toContain(node.label);
    }
    expect(wrapGraphLabel(graph.nodes[0]!.label).join(' ')).toBe(graph.nodes[0]!.label);
    expect(graph.edges.find(({ id }) => id === 'cross-link')?.relation).toBe('related');
  });

  it('collapses branches while retaining their children in the graph for expand and export', () => {
    const graph = graphFixture();
    const collapsed = layoutConceptGraph(graph, new Set(['branch-0']));
    expect(collapsed.visibleIds.has('branch-0')).toBe(true);
    expect(collapsed.visibleIds.has('node-0-0')).toBe(false);
    expect(renderConceptGraphSvg(graph)).toContain('Full label for concept 0-0 with complete visible text');
  });

  it('expands export bounds around nudged positive and negative node positions', () => {
    const graph = graphFixture();
    graph.layout = { positions: { root: { x: -300, y: -200 }, 'node-4-7': { x: 1800, y: 6200 } } };
    const layout = layoutConceptGraph(graph);
    expect(layout.minX).toBeLessThan(-300);
    expect(layout.minY).toBeLessThan(-200);
    expect(layout.width + layout.minX).toBeGreaterThan(2020);
    expect(layout.height + layout.minY).toBeGreaterThan(6200);
    expect(renderConceptGraphSvg(graph)).toContain(`viewBox="${layout.minX} ${layout.minY} ${layout.width} ${layout.height}"`);
  });
});
