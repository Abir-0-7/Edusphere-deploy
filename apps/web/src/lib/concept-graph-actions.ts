import { z } from 'zod';
import type { ConceptGraphNodeActions } from '@studyvault/types';

export const GraphHandoffSchema = z.strictObject({
  nodeId: z.string().trim().min(1).max(120),
  revision: z.coerce.number().int().positive(),
  action: z.enum(['source', 'deck', 'practice']),
});

export function readGraphHandoff(search: Pick<URLSearchParams, 'get'>) {
  const nodeId = search.get('graph_node');
  if (!nodeId) return null;
  const result = GraphHandoffSchema.safeParse({
    nodeId,
    revision: search.get('graph_revision'),
    action: search.get('graph_action'),
  });
  return result.success ? result.data : null;
}

export function graphDocumentActionHref(
  documentId: string,
  nodeId: string,
  revision: number,
  action: 'source' | 'deck' | 'practice',
): string {
  const params = new URLSearchParams({ graph_node: nodeId, graph_revision: String(revision), graph_action: action });
  return `/document/${encodeURIComponent(documentId)}?${params}`;
}

export function graphBoardActionHref(documentId: string, nodeId: string, revision: number): string {
  const params = new URLSearchParams({
    source_document: documentId, graph_node: nodeId, graph_revision: String(revision),
  });
  return `/tools?${params}#whiteboard`;
}

export function graphLessonContinueHref(lesson: NonNullable<ConceptGraphNodeActions['lesson']>): string {
  return `/courses/${encodeURIComponent(lesson.course_slug)}?enrollment=${encodeURIComponent(lesson.enrollment_id)}`;
}

export function graphBoardPreviewText(board: NonNullable<ConceptGraphNodeActions['board']>): string {
  return `${board.label}\n\n${board.quote}\n\nSource: ${board.document_id}${board.page === null ? '' : `, page ${board.page}`}`;
}
