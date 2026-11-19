import { createRoot } from 'react-dom/client';
import { BibliographyWorkspace } from '../../../src/components/bibliography-workspace';

const root = document.getElementById('root');
if (!root) throw new Error('Missing bibliography fixture root');
createRoot(root).render(
  <main className="mx-auto max-w-5xl p-4">
    <BibliographyWorkspace />
  </main>,
);
