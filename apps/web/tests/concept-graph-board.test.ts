import { describe, expect, it, vi } from 'vitest';
import { toRichText, type Editor } from 'tldraw';
import type { ConceptGraphNodeActions } from '@studyvault/types';
import { graphBoardPreviewText } from '../src/lib/concept-graph-actions';
import { insertConceptIntoTldraw } from '../src/lib/concept-graph-board';

type BoardTarget = NonNullable<ConceptGraphNodeActions['board']>;

const board: BoardTarget = {
  document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  node_id: 'node/with space',
  label: 'Validated concept',
  quote: 'A quote resolved from the current source.',
  page: 7,
};

function editorDouble(existing: boolean) {
  const shape = {
    createShape: vi.fn(),
    getShape: vi.fn(() => existing ? { id: 'existing' } : undefined),
    getViewportPageBounds: vi.fn(() => ({ center: { x: 500, y: 400 } })),
    select: vi.fn(),
  };
  return { editor: shape as unknown as Editor, shape };
}

describe('insertConceptIntoTldraw', () => {
  it('creates and selects a stable, source-grounded native text shape at the viewport center', () => {
    const { editor, shape } = editorDouble(false);
    const id = insertConceptIntoTldraw(editor, board, 9);

    expect(id).toContain(encodeURIComponent(board.node_id));
    expect(shape.createShape).toHaveBeenCalledOnce();
    const created = shape.createShape.mock.calls[0]![0] as {
      id: string; type: string; x: number; y: number;
      props: { w: number; autoSize: boolean; richText: unknown };
      meta: Record<string, unknown>;
    };
    expect(created).toMatchObject({
      id,
      type: 'text',
      x: 320,
      y: 400,
      props: { w: 360, autoSize: false, richText: toRichText(graphBoardPreviewText(board)) },
      meta: { source_document_id: board.document_id, graph_node_id: board.node_id, graph_revision: 9 },
    });
    expect(shape.select).toHaveBeenCalledWith(id);
  });

  it('selects the existing stable shape instead of inserting a duplicate', () => {
    const { editor, shape } = editorDouble(true);
    const id = insertConceptIntoTldraw(editor, board, 9);

    expect(id).toContain(encodeURIComponent(board.node_id));
    expect(shape.createShape).not.toHaveBeenCalled();
    expect(shape.select).toHaveBeenCalledWith(id);
  });
});
