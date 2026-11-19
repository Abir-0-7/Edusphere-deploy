import { createShapeId, toRichText, type Editor, type TLTextShape } from 'tldraw';
import type { ConceptGraphNodeActions } from '@studyvault/types';
import { graphBoardPreviewText } from './concept-graph-actions';

type BoardTarget = NonNullable<ConceptGraphNodeActions['board']>;

/** Insert one server-resolved graph node into the account-local tldraw board. */
export function insertConceptIntoTldraw(editor: Editor, board: BoardTarget, revision: number): string {
  const id = createShapeId(`concept-${board.document_id}-${encodeURIComponent(board.node_id)}-${revision}`);
  if (editor.getShape(id)) {
    editor.select(id);
    return id;
  }
  const center = editor.getViewportPageBounds().center;
  editor.createShape<TLTextShape>({
    id,
    type: 'text',
    x: center.x - 180,
    y: center.y,
    props: { w: 360, autoSize: false, richText: toRichText(graphBoardPreviewText(board)) },
    meta: { source_document_id: board.document_id, graph_node_id: board.node_id, graph_revision: revision },
  });
  editor.select(id);
  return id;
}
