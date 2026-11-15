'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** Concept mind map (task 4.5). Server returns nodes/edges; we lay out a star —
 * root centre, chapters on the first ring, concepts on the outer ring — in a
 * plain SVG, so no React Flow dependency is needed. */

interface MapNode {
  id: string;
  label: string;
  kind: 'root' | 'chapter' | 'concept';
}
interface MapEdge {
  source: string;
  target: string;
  label?: string;
}
interface MindMapData {
  nodes: MapNode[];
  edges: MapEdge[];
}

const baseUrl = () => process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? 'http://localhost:8000';
const SIZE = 640;
const CENTER = SIZE / 2;
const RING1 = 180;
const RING2 = 290;

export function MindMapPanel({ documentId }: { documentId: string }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<MindMapData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl()}/api/documents/${documentId}/mindmap`, {
        headers: { authorization: `Bearer ${token ?? ''}` },
      });
      if (!res.ok) {
        setErr('Could not build the map yet.');
        return;
      }
      setData((await res.json()) as MindMapData);
    } finally {
      setLoading(false);
    }
  }, [documentId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const positioned = useMemo(() => {
    if (!data) return null;
    const chapters = data.nodes.filter((n) => n.kind === 'chapter');
    const concepts = data.nodes.filter((n) => n.kind === 'concept');
    const root = data.nodes.find((n) => n.kind === 'root') ?? chapters[0] ?? data.nodes[0];

    const pos = new Map<string, { x: number; y: number }>();
    if (root) pos.set(root.id, { x: CENTER, y: CENTER });
    chapters.forEach((n, i) => {
      const angle = (i / chapters.length) * Math.PI * 2 - Math.PI / 2;
      pos.set(n.id, { x: CENTER + Math.cos(angle) * RING1, y: CENTER + Math.sin(angle) * RING1 });
    });
    // Group concepts under their parent chapter for a readable ring.
    const byChapter = new Map<string, MapNode[]>();
    for (const e of data.edges) {
      if (chapterIds(data, e.source))
        byChapter.set(e.source, [
          ...(byChapter.get(e.source) ?? []),
          ...concepts.filter((c) => c.id === e.target),
        ]);
    }
    chapters.forEach((ch, ci) => {
      const kids = byChapter.get(ch.id) ?? [];
      kids.forEach((c, ki) => {
        const angle = (ki / Math.max(1, kids.length)) * Math.PI * 2 - Math.PI / 2 + ci * 0.4;
        pos.set(c.id, { x: CENTER + Math.cos(angle) * RING2, y: CENTER + Math.sin(angle) * RING2 });
      });
    });
    return { pos, nodes: data.nodes, edges: data.edges };
  }, [data]);

  return (
    <div className="mt-3 rounded border p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Mind map</h3>
        <button onClick={() => void load()} className="text-xs text-blue-600 hover:underline">
          {loading ? '…' : 'Refresh'}
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {positioned && (
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mt-2 w-full" role="img" aria-label="concept mind map">
          {positioned.edges.map((e, i) => {
            const a = positioned.pos.get(e.source);
            const b = positioned.pos.get(e.target);
            if (!a || !b) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#cbd5e1" strokeWidth={1.5} />;
          })}
          {positioned.nodes.map((n) => {
            const p = positioned.pos.get(n.id);
            if (!p) return null;
            const fill = n.kind === 'root' ? '#2563eb' : n.kind === 'chapter' ? '#7c3aed' : '#e2e8f0';
            const textFill = n.kind === 'concept' ? '#0f172a' : '#ffffff';
            const r = n.kind === 'root' ? 34 : n.kind === 'chapter' ? 26 : 18;
            return (
              <g key={n.id}>
                <circle cx={p.x} cy={p.y} r={r} fill={fill} opacity={0.9} />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={10} fill={textFill}>
                  {n.label.length > 16 ? `${n.label.slice(0, 15)}…` : n.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {!positioned && !loading && !err && <p className="mt-2 text-sm text-neutral-500">No map yet.</p>}
    </div>
  );
}

function chapterIds(data: MindMapData, id: string): boolean {
  return data.nodes.some((n) => n.id === id && n.kind === 'chapter');
}
