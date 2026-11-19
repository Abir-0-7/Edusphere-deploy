import { ConceptGraphSchema, type ConceptGraph, type ConceptGraphEdge, type ConceptGraphNode } from '@studyvault/types';
import type { MindMapResponse } from '@studyvault/types';

const NODE_WIDTH = 220;
const LEVEL_GAP = 90;
const ROW_GAP = 32;
const TOP = 36;
const LEFT = 36;

export type GraphPoint = { x: number; y: number };
export type GraphLayout = {
  positions: Map<string, GraphPoint>;
  children: Map<string, string[]>;
  roots: string[];
  visibleIds: Set<string>;
  width: number;
  height: number;
  minX: number;
  minY: number;
};

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function wrapGraphLabel(label: string, maxChars = 22): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) lines.push(current);
      current = '';
      for (let index = 0; index < word.length; index += maxChars) lines.push(word.slice(index, index + maxChars));
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export function normalizeMindMap(data: MindMapResponse): ConceptGraph {
  const kinds = new Map(data.nodes.map((node) => [node.id, node.kind]));
  const seenNodes = new Set<string>();
  const nodes: ConceptGraphNode[] = data.nodes.filter((node) => {
    if (!node.id.trim() || node.id.length > 120 || seenNodes.has(node.id)) return false;
    seenNodes.add(node.id);
    return true;
  }).slice(0, 200).map((node) => ({
    id: node.id,
    label: node.label,
    kind: node.kind === 'root' || node.kind === 'chapter' ? node.kind : 'concept',
    objective_id: null,
    evidence_ids: [],
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeKeys = new Set<string>();
  const parents = new Set<string>();
  const edges: ConceptGraphEdge[] = [];
  for (const [index, edge] of data.edges.entries()) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target || edges.length >= 500) continue;
    const relation = !edge.label && !parents.has(edge.target) && kinds.get(edge.target) !== 'root'
      && (kinds.get(edge.source) === 'root' || kinds.get(edge.source) === 'chapter') ? 'contains' : 'related';
    const key = JSON.stringify([edge.source, edge.target, relation]);
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    if (relation === 'contains') parents.add(edge.target);
    edges.push({ id: `generated-edge-${index + 1}`, source: edge.source, target: edge.target, relation, evidence_ids: [] });
  }
  return ConceptGraphSchema.parse({ version: 1, nodes, edges, evidence: [], annotations: {}, layout: {} });
}

function collapsedIds(graph: ConceptGraph): Set<string> {
  const value = graph.layout.collapsed_ids;
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((item): item is string => typeof item === 'string'));
}

export function readGraphPositions(graph: ConceptGraph): Map<string, GraphPoint> {
  const raw = graph.layout.positions;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
  const positions = new Map<string, GraphPoint>();
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const point = value as { x?: unknown; y?: unknown };
    if (typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)) {
      positions.set(id, { x: point.x, y: point.y });
    }
  }
  return positions;
}

export function readGraphViewport(graph: ConceptGraph): { x: number; y: number; scale: number } {
  const raw = graph.layout.viewport;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { x: 0, y: 0, scale: 1 };
  const view = raw as { x?: unknown; y?: unknown; scale?: unknown };
  return {
    x: typeof view.x === 'number' && Number.isFinite(view.x) ? view.x : 0,
    y: typeof view.y === 'number' && Number.isFinite(view.y) ? view.y : 0,
    scale: typeof view.scale === 'number' && Number.isFinite(view.scale) ? Math.min(2, Math.max(0.3, view.scale)) : 1,
  };
}

export function readCollapsedIds(graph: ConceptGraph): Set<string> {
  return collapsedIds(graph);
}

export function layoutConceptGraph(graph: ConceptGraph, collapsed = collapsedIds(graph)): GraphLayout {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  const parents = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.relation !== 'contains' || !nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
    parents.add(edge.target);
  }
  const roots = graph.nodes.filter((node) => !parents.has(node.id)).map((node) => node.id);
  const linesById = new Map(graph.nodes.map((node) => [node.id, wrapGraphLabel(node.label)]));
  const heightById = new Map<string, number>();
  const depthById = new Map<string, number>();
  const visiting = new Set<string>();
  const subtreeHeight = (id: string, depth: number): number => {
    if (visiting.has(id)) return 64;
    visiting.add(id);
    depthById.set(id, Math.max(depthById.get(id) ?? 0, depth));
    const nodeHeight = Math.max(58, (linesById.get(id)?.length ?? 1) * 18 + 22);
    const kids = collapsed.has(id) ? [] : children.get(id) ?? [];
    const childHeights = kids.map((child) => subtreeHeight(child, depth + 1));
    const childrenHeight = childHeights.reduce((total, childHeight) => total + childHeight, 0) + Math.max(0, kids.length - 1) * ROW_GAP;
    visiting.delete(id);
    const height = Math.max(nodeHeight, childrenHeight);
    heightById.set(id, height);
    return height;
  };
  let totalHeight = 0;
  for (const root of roots) totalHeight += subtreeHeight(root, 0);
  totalHeight += Math.max(0, roots.length - 1) * ROW_GAP;
  const maxDepth = Math.max(0, ...depthById.values());
  const width = Math.max(520, LEFT * 2 + NODE_WIDTH + maxDepth * (NODE_WIDTH + LEVEL_GAP));
  const height = Math.max(400, TOP * 2 + totalHeight);
  const positions = new Map<string, GraphPoint>();
  const visibleIds = new Set<string>();
  const place = (id: string, depth: number, top: number) => {
    const nodeHeight = Math.max(58, (linesById.get(id)?.length ?? 1) * 18 + 22);
    const subtree = heightById.get(id) ?? nodeHeight;
    const kids = collapsed.has(id) ? [] : children.get(id) ?? [];
    const kidsHeight = kids.reduce((sum, kid) => sum + (heightById.get(kid) ?? 58), 0) + Math.max(0, kids.length - 1) * ROW_GAP;
    const y = top + Math.max(nodeHeight / 2, (subtree - kidsHeight) / 2 + kidsHeight / 2);
    positions.set(id, { x: LEFT + depth * (NODE_WIDTH + LEVEL_GAP), y });
    visibleIds.add(id);
    let childTop = top;
    for (const child of kids) {
      place(child, depth + 1, childTop);
      childTop += (heightById.get(child) ?? 58) + ROW_GAP;
    }
  };
  let rootTop = TOP;
  for (const root of roots) {
    place(root, 0, rootTop);
    rootTop += (heightById.get(root) ?? 58) + ROW_GAP;
  }
  // Disconnected nodes that were inside a malformed/unrooted component still remain visible.
  const storedPositions = readGraphPositions(graph);
  for (const id of visibleIds) {
    const saved = storedPositions.get(id);
    if (saved) positions.set(id, saved);
  }
  let minX = 0;
  let minY = 0;
  let maxX = width;
  let maxY = Math.max(height, rootTop + TOP);
  for (const id of visibleIds) {
    const point = positions.get(id)!;
    const nodeHeight = Math.max(58, (linesById.get(id)?.length ?? 1) * 18 + 22);
    minX = Math.min(minX, point.x - LEFT);
    minY = Math.min(minY, point.y - nodeHeight / 2 - TOP);
    maxX = Math.max(maxX, point.x + NODE_WIDTH + LEFT);
    maxY = Math.max(maxY, point.y + nodeHeight / 2 + TOP);
  }
  return { positions, children, roots, visibleIds, width: maxX - minX, height: maxY - minY, minX, minY };
}

export function renderConceptGraphSvg(graph: ConceptGraph): string {
  const layout = layoutConceptGraph(graph, new Set());
  const nodeMarkup = graph.nodes.map((node) => {
    const point = layout.positions.get(node.id)!;
    const lines = wrapGraphLabel(node.label);
    const boxHeight = Math.max(58, lines.length * 18 + 22);
    const color = node.kind === 'root' ? '#1d4ed8' : node.kind === 'chapter' ? '#6d28d9' : node.kind === 'objective' ? '#047857' : '#f1f5f9';
    const ink = node.kind === 'concept' ? '#0f172a' : '#ffffff';
    const label = lines.map((line, index) => `<text x="${point.x + NODE_WIDTH / 2}" y="${point.y - (lines.length - 1) * 9 + index * 18 + 5}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="${ink}">${escapeXml(line)}</text>`).join('');
    return `<g data-node-id="${escapeXml(node.id)}"><title>${escapeXml(node.label)}</title><rect x="${point.x}" y="${point.y - boxHeight / 2}" width="${NODE_WIDTH}" height="${boxHeight}" rx="10" fill="${color}" stroke="#475569"/><text x="${point.x + NODE_WIDTH / 2}" y="${point.y - (lines.length - 1) * 9 + 5}" text-anchor="middle" font-family="sans-serif" font-size="0" opacity="0">${escapeXml(node.label)}</text>${label}</g>`;
  }).join('');
  const edgeMarkup = graph.edges.map((edge) => {
    const from = layout.positions.get(edge.source);
    const to = layout.positions.get(edge.target);
    if (!from || !to) return '';
    const x1 = from.x + NODE_WIDTH;
    const y1 = from.y;
    const x2 = to.x;
    const y2 = to.y;
    const relation = edge.relation === 'contains' ? '' : `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" font-family="sans-serif" font-size="12" fill="#334155">${escapeXml(edge.relation)}</text>`;
    return `<g data-edge-id="${escapeXml(edge.id)}"><path d="M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" fill="none" stroke="${edge.relation === 'contains' ? '#94a3b8' : '#d97706'}" stroke-width="2" marker-end="url(#arrow)"/>${relation}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="${layout.minX} ${layout.minY} ${layout.width} ${layout.height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#64748b"/></marker></defs><rect x="${layout.minX}" y="${layout.minY}" width="100%" height="100%" fill="#ffffff"/>${edgeMarkup}${nodeMarkup}</svg>`;
}

export function serializeConceptGraph(graph: ConceptGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}
