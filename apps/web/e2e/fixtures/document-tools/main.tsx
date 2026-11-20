import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VivaPanel } from '@/components/viva-panel';
import { MindMapPanel } from '@/components/mindmap-panel';
import { switchOwner } from './clerk';

function Fixture() {
  const [id, setId] = useState('11111111-1111-4111-8111-111111111111');
  return (
    <main style={{ maxWidth: 800, margin: 'auto' }}>
      <button onClick={switchOwner}>Switch account</button>
      <button onClick={() => setId('22222222-2222-4222-8222-222222222222')}>Switch document</button>
      <h1>Photosynthesis study document</h1>
      <p>Saved summary: Leaves convert light energy into chemical energy.</p>
      <MindMapPanel documentId={id} />
      <VivaPanel documentId={id} />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
