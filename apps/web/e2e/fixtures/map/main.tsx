import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { MindMapPanel } from '../../../src/components/mindmap-panel';
import DocumentPage from '../../../src/app/(protected)/document/[id]/page';
import { BoardLearningPreview } from '../../../src/components/board-learning-preview';
import { graphBoardPreviewText } from '../../../src/lib/concept-graph-actions';
import '../../../src/app/globals.css';

const host = document.getElementById('root');
if (!host) throw new Error('Missing map fixture root');
const getToken = async () => 'fixture-token';
const boardHandoff = { documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nodeId: 'leaf-0-0', revision: 4 };
function BoardFixture() {
  const [notes, setNotes] = useState(['Existing board shape']);
  return (
    <main style={{ margin: '20px auto', maxWidth: 1100, fontFamily: 'Arial' }}>
      <h1>Board concept insertion acceptance</h1>
      <BoardLearningPreview
        ownerId="map-fixture-owner"
        getToken={getToken}
        handoff={boardHandoff}
        onInsert={(board) => setNotes((current) => [...current, graphBoardPreviewText(board)])}
      />
      <ul aria-label="Existing local board shapes">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
    </main>
  );
}

createRoot(host).render(location.pathname.startsWith('/document/')
  ? <DocumentPage />
  : new URLSearchParams(location.search).has('board_preview')
  ? <BoardFixture />
  : <main style={{ margin: '20px auto', maxWidth: 1100, fontFamily: 'Arial' }}><h1>Saved concept graph acceptance</h1><MindMapPanel documentId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" /></main>);
