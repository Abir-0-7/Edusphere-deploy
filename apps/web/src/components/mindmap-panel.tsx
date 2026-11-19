'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ConceptGraphSchema, type ConceptGraph, type ConceptGraphNode, type ConceptGraphNodeActions } from '@studyvault/types';
import {
  AiHttpError, getConceptGraphNodeActions, getGeneratedMindMap, getSavedConceptGraph,
  regenerateConceptGraph, saveConceptGraph,
} from '@/lib/ai-client';
import { graphBoardActionHref, graphDocumentActionHref, graphLessonContinueHref } from '@/lib/concept-graph-actions';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import {
  layoutConceptGraph,
  normalizeMindMap,
  readCollapsedIds,
  readGraphViewport,
  readGraphPositions,
  renderConceptGraphSvg,
  serializeConceptGraph,
  wrapGraphLabel,
} from '@/lib/concept-graph';

type Point = { x: number; y: number };

const field = 'rounded border border-neutral-400 px-2 py-1 text-sm';
const button = 'rounded border border-blue-700 px-2.5 py-1.5 text-xs font-medium text-blue-800 disabled:opacity-50';
const primary = 'rounded bg-blue-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function graphPng(graph: ConceptGraph): Promise<{ blob: Blob; width: number; height: number }> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('SVG export could not be rendered.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderConceptGraphSvg(graph))}`;
  await loaded;
  if (image.width > 16000 || image.height > 16000 || image.width * image.height > 40_000_000) {
    throw new Error('This graph is too large for a safe raster export. Export SVG or JSON instead.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.width);
  canvas.height = Math.max(1, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not create an export canvas.');
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the PNG export.');
  return { blob, width: canvas.width, height: canvas.height };
}

function graphLayout(graph: ConceptGraph, positions: Map<string, Point>, viewport: { x: number; y: number; scale: number }, collapsed: Set<string>): ConceptGraph {
  const serializedPositions: Record<string, Point> = {};
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const [id, point] of readGraphPositions(graph)) if (nodeIds.has(id)) serializedPositions[id] = point;
  for (const [id, point] of positions) serializedPositions[id] = point;
  return ConceptGraphSchema.parse({
    ...graph,
    layout: {
      ...graph.layout,
      positions: serializedPositions,
      viewport,
      collapsed_ids: [...collapsed],
    },
  });
}

function nodeColor(kind: ConceptGraphNode['kind']): { fill: string; text: string } {
  if (kind === 'root') return { fill: '#1d4ed8', text: '#fff' };
  if (kind === 'chapter') return { fill: '#6d28d9', text: '#fff' };
  if (kind === 'objective') return { fill: '#047857', text: '#fff' };
  return { fill: '#f1f5f9', text: '#0f172a' };
}

export function MindMapPanel({ documentId }: { documentId: string }) {
  const { getToken, userId } = useAuth();
  const [graph, setGraph] = useState<ConceptGraph | null>(null);
  const [revision, setRevision] = useState<number | undefined>();
  const [source, setSource] = useState<'saved' | 'generated'>('saved');
  const [history, setHistory] = useState<ConceptGraph[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [annotationInput, setAnnotationInput] = useState('');
  const [actions, setActions] = useState<ConceptGraphNodeActions | null>(null);
  const [actionsError, setActionsError] = useState('');
  const [actionsLoading, setActionsLoading] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [newNodeLabel, setNewNodeLabel] = useState('');
  const [newNodeKind, setNewNodeKind] = useState<ConceptGraphNode['kind']>('concept');
  const [newObjectiveId, setNewObjectiveId] = useState('');
  const [edgeSource, setEdgeSource] = useState('');
  const [edgeTarget, setEdgeTarget] = useState('');
  const [edgeRelation, setEdgeRelation] = useState<'contains' | 'prerequisite' | 'related' | 'supports'>('related');
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const canvasContainer = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const saved = await getSavedConceptGraph(getToken, documentId);
      setGraph(saved.graph);
      setRevision(saved.revision);
      setSource('saved');
      setViewport(readGraphViewport(saved.graph));
      setStatus(`Saved graph revision ${saved.revision}.`);
    } catch (caught) {
      if (!(caught instanceof AiHttpError) || caught.status !== 404) {
        setError(caught instanceof Error ? caught.message : 'Could not load the concept graph.');
        setLoading(false);
        return;
      }
      try {
        const generated = normalizeMindMap(await getGeneratedMindMap(getToken, documentId));
        setGraph(generated);
        setRevision(undefined);
        setSource('generated');
        setViewport(readGraphViewport(generated));
        setStatus('Generated map loaded. Save explicitly to keep edits.');
      } catch (fallbackError) {
        setError(fallbackError instanceof Error ? fallbackError.message : 'Could not build the concept graph.');
      }
    } finally {
      setLoading(false);
    }
  }, [documentId, getToken, userId]);

  useEffect(() => { void load(); }, [load]);

  const collapsed = useMemo(() => graph ? readCollapsedIds(graph) : new Set<string>(), [graph]);
  const searchTerm = search.trim().toLocaleLowerCase();
  const activeCollapsed = searchTerm ? new Set<string>() : collapsed;
  const positioned = useMemo(() => graph ? layoutConceptGraph(graph, activeCollapsed) : null, [graph, activeCollapsed]);
  const filteredIds = useMemo(() => {
    if (!graph || !searchTerm) return new Set(graph?.nodes.map((node) => node.id) ?? []);
    return new Set(graph.nodes.filter((node) => node.label.toLocaleLowerCase().includes(searchTerm)).map((node) => node.id));
  }, [graph, searchTerm]);
  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null;
  useEffect(() => { setLabelInput(selected?.label ?? ''); }, [selected?.id, selected?.label]);
  useEffect(() => { setAnnotationInput(selected ? graph?.annotations?.[selected.id] ?? '' : ''); }, [graph?.annotations, selected]);
  useEffect(() => {
    let active = true;
    setActions(null);
    setActionsError('');
    setLessonOpen(false);
    if (!selectedId || revision === undefined || history.length > 0) return () => { active = false; };
    setActionsLoading(true);
    void getConceptGraphNodeActions(getToken, documentId, selectedId, revision).then((value) => {
      if (active) setActions(value);
    }).catch((caught: unknown) => {
      if (active) setActionsError(caught instanceof Error ? caught.message : 'Learning actions could not be resolved.');
    }).finally(() => { if (active) setActionsLoading(false); });
    return () => { active = false; };
  }, [documentId, getToken, history.length, revision, selectedId, userId]);
  useEffect(() => {
    if (!selectedId || !positioned || !canvasContainer.current) return;
    const point = positioned.positions.get(selectedId);
    if (!point) return;
    const container = canvasContainer.current;
    const canvasWidth = Math.max(container.clientWidth, Math.min(positioned.width, 900));
    const scale = canvasWidth / positioned.width;
    container.scrollTo({
      left: Math.max(0, (point.x - positioned.minX - 30) * scale),
      top: Math.max(0, (point.y - positioned.minY - 180) * scale),
      behavior: 'auto',
    });
  }, [selectedId, positioned]);

  const updateGraph = useCallback((update: (current: ConceptGraph) => ConceptGraph) => {
    setGraph((current) => {
      if (!current) return current;
      const next = update(current);
      setHistory((previous) => [...previous.slice(-19), current]);
      return next;
    });
  }, []);

  function editSelectedLabel(label: string) {
    if (!graph || !selected || !label.trim() || label.trim() === selected.label) return;
    updateGraph((current) => ConceptGraphSchema.parse({
      ...current,
      nodes: current.nodes.map((node) => node.id === selected.id ? { ...node, label: label.trim() } : node),
    }));
    setStatus('Label changed. Save to persist the graph.');
  }

  function editSelectedAnnotation() {
    if (!graph || !selected) return;
    updateGraph((current) => ConceptGraphSchema.parse({
      ...current,
      annotations: { ...current.annotations, [selected.id]: annotationInput.trim() },
    }));
    setStatus('Annotation changed. Save to persist it with this graph.');
  }

  function addNode() {
    if (!graph || !newNodeLabel.trim()) return;
    if (newNodeKind === 'objective' && !newObjectiveId.trim()) {
      setError('Objective nodes need a shared objective ID.');
      return;
    }
    const node: ConceptGraphNode = {
      id: crypto.randomUUID(),
      label: newNodeLabel.trim(),
      kind: newNodeKind,
      objective_id: newNodeKind === 'objective' ? newObjectiveId.trim() : null,
      evidence_ids: [],
    };
    const edges = selectedId ? [...graph.edges, {
      id: crypto.randomUUID(), source: selectedId, target: node.id, relation: 'contains' as const, evidence_ids: [],
    }] : graph.edges;
    try {
      const next = ConceptGraphSchema.parse({ ...graph, nodes: [...graph.nodes, node], edges });
      updateGraph(() => next);
      setSelectedId(node.id);
      setNewNodeLabel('');
      setNewObjectiveId('');
      setError('');
      setStatus('Node added. Save to persist the graph.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add this node.');
    }
  }

  function addEdge() {
    if (!graph || !edgeSource || !edgeTarget) return;
    const edge = { id: crypto.randomUUID(), source: edgeSource, target: edgeTarget, relation: edgeRelation, evidence_ids: [] };
    try {
      const next = ConceptGraphSchema.parse({ ...graph, edges: [...graph.edges, edge] });
      updateGraph(() => next);
      setError('');
      setStatus('Relationship added. Save to persist the graph.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add this relationship.');
    }
  }

  function deleteSelected() {
    if (!graph || !selected || graph.nodes.length <= 2) return;
    const nodes = graph.nodes.filter((node) => node.id !== selected.id);
    const edges = graph.edges.filter((edge) => edge.source !== selected.id && edge.target !== selected.id);
    const referenced = new Set([...nodes.flatMap((node) => node.evidence_ids), ...edges.flatMap((edge) => edge.evidence_ids)]);
    updateGraph((current) => ConceptGraphSchema.parse({
      ...current,
      nodes,
      edges,
      evidence: current.evidence.filter((item) => referenced.has(item.id)),
      annotations: Object.fromEntries(Object.entries(current.annotations).filter(([id]) => id !== selected.id)),
    }));
    setSelectedId(null);
    setStatus('Node and connected relationships removed. Save to persist the graph.');
  }

  function nudgeSelected(dx: number, dy: number) {
    if (!graph || !selectedId || !positioned) return;
    const current = positioned.positions.get(selectedId) ?? { x: 40, y: 40 };
    const positions = new Map(positioned.positions);
    positions.set(selectedId, { x: current.x + dx, y: current.y + dy });
    updateGraph((value) => graphLayout(value, positions, viewport, collapsed));
    setStatus('Layout changed. Save to persist the graph.');
  }

  function toggleCollapsed(id: string) {
    if (!graph) return;
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    updateGraph((value) => graphLayout(value, positioned?.positions ?? new Map(), viewport, next));
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setGraph(previous);
    setViewport(readGraphViewport(previous));
    setStatus('Undid the last graph edit.');
  }

  function fitGraph() {
    setViewport({ x: 0, y: 0, scale: 1 });
    setStatus('Fit reset. Scroll the canvas or collapse a branch for a closer view.');
  }

  async function save() {
    if (!graph || saving) return;
    setSaving(true);
    setError('');
    try {
      const prepared = graphLayout(graph, positioned?.positions ?? new Map(), viewport, collapsed);
      const saved = await saveConceptGraph(getToken, documentId, prepared, revision);
      setGraph(saved.graph);
      setRevision(saved.revision);
      setSource('saved');
      setHistory([]);
      setStatus(`Saved graph revision ${saved.revision}, including layout.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the graph.');
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    if (!graph || revision === undefined || saving || history.length > 0) return;
    setSaving(true);
    setError('');
    try {
      const prepared = graphLayout(graph, positioned?.positions ?? new Map(), viewport, collapsed);
      const saved = await saveConceptGraph(getToken, documentId, prepared, revision);
      setGraph(saved.graph);
      setRevision(saved.revision);
      const regenerated = await regenerateConceptGraph(getToken, documentId, saved.revision);
      setGraph(regenerated.graph);
      setRevision(regenerated.revision);
      setSource('saved');
      setHistory([]);
      setViewport(readGraphViewport(regenerated.graph));
      setStatus(`Regenerated graph revision ${regenerated.revision}. Saved annotations and layout were retained.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not regenerate this graph.');
    } finally {
      setSaving(false);
    }
  }

  function exportJson() {
    if (!graph) return;
    downloadBlob(new Blob([serializeConceptGraph(graph)], { type: 'application/json' }), `concept-graph-${documentId}.json`);
  }

  function exportSvg() {
    if (!graph) return;
    downloadBlob(new Blob([renderConceptGraphSvg(graph)], { type: 'image/svg+xml;charset=utf-8' }), `concept-graph-${documentId}.svg`);
  }

  async function exportPng() {
    if (!graph) return;
    try {
      const { blob } = await graphPng(graph);
      downloadBlob(blob, `concept-graph-${documentId}.png`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'PNG export failed.');
    }
  }

  async function exportPdf() {
    if (!graph) return;
    try {
      const { blob, width, height } = await graphPng(graph);
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      const image = await pdf.embedPng(await blob.arrayBuffer());
      const pageWidth = width * 0.75;
      const pageHeight = height * 0.75;
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      const bytes = await pdf.save();
      downloadBlob(new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }), `concept-graph-${documentId}.pdf`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'PDF export failed.');
    }
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    drag.current = { x: event.clientX, y: event.clientY, originX: viewport.x, originY: viewport.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    setViewport((current) => ({ ...current, x: drag.current!.originX + event.clientX - drag.current!.x, y: drag.current!.originY + event.clientY - drag.current!.y }));
  }

  function renderOutline(id: string): ReactNode {
    if (!graph || !positioned) return null;
    const node = graph.nodes.find((item) => item.id === id);
    if (!node) return null;
    const children = positioned.children.get(id) ?? [];
    const hasMatch = (candidate: string, seen = new Set<string>()): boolean => {
      if (seen.has(candidate)) return false;
      seen.add(candidate);
      if (filteredIds.has(candidate)) return true;
      return (positioned.children.get(candidate) ?? []).some((child) => hasMatch(child, seen));
    };
    if (searchTerm && !hasMatch(id)) return null;
    const expanded = searchTerm.length > 0 || !collapsed.has(id);
    const links = graph.edges.filter((edge) => edge.source === id && edge.relation !== 'contains');
    return (
      <li key={id} className="ps-3">
        <div className="flex flex-wrap items-center gap-1">
          {children.length > 0 && <button type="button" className="rounded px-1 text-xs text-blue-800" aria-label={`${collapsed.has(id) ? 'Expand' : 'Collapse'} ${node.label}`} onClick={() => toggleCollapsed(id)}>{collapsed.has(id) ? '+' : '−'}</button>}
          <button type="button" className={`text-left hover:underline ${selectedId === id ? 'font-semibold text-blue-800' : ''}`} onClick={() => setSelectedId(id)}>{node.label}</button>
          <span className="text-xs text-neutral-500">{node.kind}</span>
          {links.map((edge) => <span key={edge.id} className="rounded bg-amber-50 px-1 text-xs text-amber-900">{edge.relation} → {graph.nodes.find((item) => item.id === edge.target)?.label}</span>)}
        </div>
        {expanded && children.length > 0 && <ul className="ms-3 mt-1 space-y-1 border-s-2 border-neutral-200">{children.map(renderOutline)}</ul>}
      </li>
    );
  }

  if (loading) return <div className="mt-3 rounded border p-3 text-sm">Loading concept graph…</div>;
  if (!graph || !positioned) return <div className="mt-3 rounded border p-3 text-sm"><p role="alert" className="text-red-700">{error || 'No concept graph yet.'}</p><button type="button" className={`${button} mt-2`} onClick={() => void load()}>Retry</button></div>;

  return (
    <section className="mt-3 rounded border p-3" aria-label="Saved concept graph">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Concept graph {revision ? `(revision ${revision})` : '(generated preview)'}</h3>
        <button type="button" className={button} onClick={() => void load()}>Refresh</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="toolbar" aria-label="Concept graph controls">
        <label className="sr-only" htmlFor="concept-graph-search">Search graph labels</label>
        <input id="concept-graph-search" className={field} placeholder="Search labels" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="sr-only" htmlFor="concept-graph-branch">Focus branch</label>
        <select id="concept-graph-branch" className={field} value={selectedId ?? ''} onChange={(event) => setSelectedId(event.target.value || null)}>
          <option value="">Focus branch</option>
          {graph.nodes.filter((node) => node.kind === 'root' || node.kind === 'chapter').map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select>
        <button type="button" className={button} onClick={() => setViewport((current) => ({ ...current, scale: Math.min(2, current.scale + 0.2) }))}>Zoom in</button>
        <button type="button" className={button} onClick={() => setViewport((current) => ({ ...current, scale: Math.max(0.3, current.scale - 0.2) }))}>Zoom out</button>
        <button type="button" className={button} onClick={fitGraph}>Fit</button>
        <button type="button" className={button} disabled={history.length === 0} onClick={undo}>Undo</button>
        <button type="button" className={button} disabled={revision === undefined || saving || history.length > 0} onClick={() => void regenerate()}>Regenerate from source</button>
        <button type="button" className={primary} disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : source === 'generated' ? 'Save graph' : 'Save edits'}</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2" aria-label="Concept graph exports">
        <button type="button" className={button} onClick={exportJson}>Export JSON</button>
        <button type="button" className={button} onClick={exportSvg}>Export SVG</button>
        <button type="button" className={button} onClick={() => void exportPng()}>Export PNG</button>
        <button type="button" className={button} onClick={() => void exportPdf()}>Export PDF</button>
      </div>
      {status && <p role="status" className="mt-2 text-xs text-neutral-700">{status}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      {selected && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-neutral-50 p-2 text-xs">
          <span className="font-medium">Selected: {selected.label}</span>
          <button type="button" className={button} onClick={() => toggleCollapsed(selected.id)}>{collapsed.has(selected.id) ? 'Expand branch' : 'Collapse branch'}</button>
          <button type="button" className={button} onClick={() => nudgeSelected(-24, 0)}>Move left</button>
          <button type="button" className={button} onClick={() => nudgeSelected(24, 0)}>Move right</button>
          <button type="button" className={button} onClick={() => nudgeSelected(0, -24)}>Move up</button>
          <button type="button" className={button} onClick={() => nudgeSelected(0, 24)}>Move down</button>
          <label className="flex items-center gap-1">Label<input aria-label="Edit selected label" className={field} value={labelInput} onChange={(event) => setLabelInput(event.target.value)} /></label>
          <button type="button" className={button} onClick={() => editSelectedLabel(labelInput)}>Update label</button>
          <label className="flex w-full items-start gap-2">Annotation<textarea aria-label="Selected node annotation" className={field} rows={2} maxLength={4000} value={annotationInput} onChange={(event) => setAnnotationInput(event.target.value)} /></label>
          <button type="button" className={button} onClick={editSelectedAnnotation}>Update annotation</button>
          <button type="button" className={button} disabled={graph.nodes.length <= 2} onClick={deleteSelected}>Delete node</button>
        </div>
      )}
      {selected && (
        <div role="region" className="mt-2 rounded border border-blue-200 bg-blue-50/40 p-3 text-sm" aria-label="Selected concept learning actions">
          {history.length > 0 || revision === undefined ? <p>Save this graph before opening its learning actions.</p> : actionsLoading ? <p>Resolving the saved node's learning actions…</p> : null}
          {actionsError && <p role="alert" className="text-red-700">{actionsError}</p>}
          {actions && revision !== undefined && history.length === 0 && (
            <>
              <div className="flex flex-wrap gap-2">
                {actions.source && <a className={button} href={graphDocumentActionHref(documentId, selected.id, revision, 'source')}>Open source</a>}
                {actions.deck && <a className={button} href={graphDocumentActionHref(documentId, selected.id, revision, 'deck')}>Open deck</a>}
                {actions.deck && <a className={button} href={graphDocumentActionHref(documentId, selected.id, revision, 'practice')}>Practice this concept</a>}
                {actions.lesson && <button type="button" className={button} onClick={() => setLessonOpen((current) => !current)}>{lessonOpen ? 'Hide lesson' : 'Open lesson'}</button>}
                {actions.board && <a className={button} href={graphBoardActionHref(documentId, selected.id, revision)}>Add to board</a>}
              </div>
              {!actions.source && <p>This saved node has no verified source evidence. Link current evidence before using learning actions.</p>}
              {actions.source && <blockquote className="mt-2 border-s-2 border-blue-400 ps-2 text-neutral-700">{actions.source.quote}</blockquote>}
              {actions.source && !actions.deck && <p className="mt-2 text-xs text-neutral-600">No approved cards currently match this node's source.</p>}
              {lessonOpen && actions.lesson && (
                <article className="mt-3 border-t border-blue-200 pt-3" aria-label="Linked lesson preview">
                  <h4 className="font-semibold">{actions.lesson.title}</h4>
                  <p className="mt-1 text-xs text-neutral-600">Read-only lesson preview. Opening it does not change course progress.</p>
                  <MarkdownRenderer markdown={actions.lesson.content} className="mt-2" />
                  <a className="mt-3 inline-block font-medium text-blue-800 underline" href={graphLessonContinueHref(actions.lesson)}>Continue course</a>
                </article>
              )}
            </>
          )}
        </div>
      )}
      <div className="mt-2 grid gap-2 rounded border bg-neutral-50 p-2 sm:grid-cols-2">
        <fieldset className="flex flex-wrap items-end gap-2">
          <legend className="text-xs font-semibold">Add {selected ? 'child node' : 'node'}</legend>
          <label className="text-xs">Label<input aria-label="New graph node label" className={`${field} block`} maxLength={200} value={newNodeLabel} onChange={(event) => setNewNodeLabel(event.target.value)} /></label>
          <label className="text-xs">Kind<select aria-label="New graph node kind" className={`${field} block`} value={newNodeKind} onChange={(event) => setNewNodeKind(event.target.value as ConceptGraphNode['kind'])}><option value="concept">Concept</option><option value="chapter">Chapter</option><option value="objective">Objective</option></select></label>
          {newNodeKind === 'objective' && <label className="text-xs">Objective ID<input aria-label="New objective ID" className={`${field} block`} value={newObjectiveId} onChange={(event) => setNewObjectiveId(event.target.value)} /></label>}
          <button type="button" className={button} onClick={addNode}>Add node</button>
        </fieldset>
        <fieldset className="flex flex-wrap items-end gap-2">
          <legend className="text-xs font-semibold">Add relationship</legend>
          <label className="text-xs">From<select aria-label="Relationship source" className={`${field} block`} value={edgeSource} onChange={(event) => setEdgeSource(event.target.value)}><option value="">Choose node</option>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
          <label className="text-xs">Type<select aria-label="Relationship type" className={`${field} block`} value={edgeRelation} onChange={(event) => setEdgeRelation(event.target.value as typeof edgeRelation)}><option value="contains">Contains</option><option value="related">Related</option><option value="supports">Supports</option><option value="prerequisite">Prerequisite</option></select></label>
          <label className="text-xs">To<select aria-label="Relationship target" className={`${field} block`} value={edgeTarget} onChange={(event) => setEdgeTarget(event.target.value)}><option value="">Choose node</option>{graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
          <button type="button" className={button} disabled={!edgeSource || !edgeTarget} onClick={addEdge}>Add link</button>
        </fieldset>
      </div>
      <div ref={canvasContainer} className="mt-2 overflow-auto rounded border bg-white" style={{ maxHeight: 560, overflow: 'auto', position: 'relative' }}>
        <svg
          viewBox={`${positioned.minX} ${positioned.minY} ${positioned.width} ${positioned.height}`}
          className="min-h-[360px] w-full"
          style={{ display: 'block', width: '100%', minWidth: Math.min(positioned.width, 900), minHeight: 360 }}
          role="group"
          aria-label="Saved concept graph canvas"
          tabIndex={0}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={() => { drag.current = null; }}
          onWheel={(event) => { event.preventDefault(); setViewport((current) => ({ ...current, scale: Math.min(2, Math.max(0.3, current.scale + (event.deltaY < 0 ? 0.1 : -0.1))) })); }}
        >
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            {graph.edges.map((edge) => {
              const from = positioned.positions.get(edge.source); const to = positioned.positions.get(edge.target);
              if (!from || !to || !positioned.visibleIds.has(edge.source) || !positioned.visibleIds.has(edge.target)) return null;
              return <path key={edge.id} d={`M ${from.x + 220} ${from.y} C ${(from.x + to.x + 220) / 2} ${from.y}, ${(from.x + to.x + 220) / 2} ${to.y}, ${to.x} ${to.y}`} fill="none" stroke={edge.relation === 'contains' ? '#94a3b8' : '#d97706'} strokeWidth={2} />;
            })}
            {graph.nodes.map((node) => {
              const point = positioned.positions.get(node.id);
              if (!point || !positioned.visibleIds.has(node.id)) return null;
              const lines = wrapGraphLabel(node.label);
              const boxHeight = Math.max(58, lines.length * 18 + 22);
              const colors = nodeColor(node.kind);
              const matching = filteredIds.has(node.id);
              return <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={node.label}
                opacity={matching ? 1 : 0.28}
                onClick={() => setSelectedId(node.id)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(node.id); } }}
              >
                <title>{node.label}</title>
                <rect x={point.x} y={point.y - boxHeight / 2} width={220} height={boxHeight} rx={10} fill={colors.fill} stroke={selectedId === node.id ? '#dc2626' : '#475569'} strokeWidth={selectedId === node.id ? 3 : 1} />
                {lines.map((line, index) => <text key={`${node.id}-${index}`} x={point.x + 110} y={point.y - (lines.length - 1) * 9 + index * 18 + 5} textAnchor="middle" fontSize={14} fill={colors.text}>{line}</text>)}
              </g>;
            })}
          </g>
        </svg>
      </div>
      <details className="mt-3 rounded border p-2" open>
        <summary className="cursor-pointer text-sm font-semibold">Keyboard outline ({graph.nodes.length} nodes)</summary>
        <ul aria-label="Concept graph keyboard outline" className="mt-2 space-y-1 text-sm">
          {positioned.roots.map(renderOutline)}
        </ul>
      </details>
    </section>
  );
}
