import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConceptGraphNodeActions, regenerateConceptGraph } from '../src/lib/ai-client';
import {
  graphBoardActionHref,
  graphBoardPreviewText,
  graphDocumentActionHref,
  graphLessonContinueHref,
  readGraphHandoff,
} from '../src/lib/concept-graph-actions';
import { readBoardGraphHandoff } from '../src/components/board-learning-preview';
import type { ConceptGraphNodeActions } from '@studyvault/types';

const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nodeId = 'node/id with space';
const getToken = async () => 'graph-owner-token';
const actions: ConceptGraphNodeActions = {
  graph_revision: 3,
  node_id: nodeId,
  source: {
    document_id: documentId, chapter_id: null,
    chunk_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', page: null, quote: 'Source quotation.',
  },
  lesson: null, deck: null,
  board: { document_id: documentId, node_id: nodeId, label: 'Node label', quote: 'Source quotation.', page: 2 },
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('saved concept learning handoffs', () => {
  it('passes only node/revision/action and resolves IDs through the owner-scoped API', () => {
    const href = graphDocumentActionHref(documentId, nodeId, 3, 'practice');
    expect(readGraphHandoff(new URL(href, 'https://study.test').searchParams)).toEqual({
      nodeId, revision: 3, action: 'practice',
    });
    expect(href).not.toContain('card_ids');
    expect(href).not.toContain('source_quote');
    expect(readGraphHandoff(new URLSearchParams({ graph_node: nodeId, graph_revision: '0', graph_action: 'practice' }))).toBeNull();
  });

  it('scopes board preview to the saved source and uses a safe pinned-course continuation', () => {
    const boardUrl = graphBoardActionHref(documentId, nodeId, 3);
    expect(readBoardGraphHandoff(new URL(boardUrl, 'https://study.test').searchParams)).toEqual({
      documentId, nodeId, revision: 3,
    });
    expect(graphBoardPreviewText(actions.board!)).toContain('Node label\n\nSource quotation.');
    expect(graphBoardPreviewText(actions.board!)).toContain('page 2');
    expect(graphLessonContinueHref({
      enrollment_id: documentId, course_slug: 'python-foundations', lesson_id: 'lesson-id',
      objective_id: 'shared-objective', title: 'Lesson', content: 'Lesson content',
    })).toBe(`/courses/python-foundations?enrollment=${documentId}`);
  });

  it('checks the response node, document and revision before using a link', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(actions), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);
    await expect(getConceptGraphNodeActions(getToken, documentId, nodeId, 3)).resolves.toEqual(actions);
    expect(fetch.mock.calls[0]?.[0]).toContain('node%2Fid%20with%20space/actions?revision=3');
    await expect(getConceptGraphNodeActions(getToken, documentId, nodeId, 4)).rejects.toThrow('does not match');
  });

  it('sends the exact expected revision when explicitly regenerating', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', document_id: documentId, revision: 4,
      graph: { version: 1, nodes: [
        { id: 'root', label: 'Root', kind: 'root', objective_id: null, evidence_ids: [] },
        { id: 'child', label: 'Child', kind: 'concept', objective_id: null, evidence_ids: [] },
      ], edges: [], evidence: [], annotations: {}, layout: {} },
      created_at: '2026-11-19T00:00:00Z', updated_at: '2026-11-19T00:00:00Z',
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const response = await regenerateConceptGraph(getToken, documentId, 3);
    expect(response.revision).toBe(4);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ expected_revision: 3 });
  });
});
