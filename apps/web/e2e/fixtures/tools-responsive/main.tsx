import { createRoot } from 'react-dom/client';
import ToolsPage from '../../../src/app/(protected)/tools/page';
import '../../../src/app/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing toolkit fixture root');
createRoot(root).render(
  <div className="app-frame">
    <aside className="app-sidebar" aria-label="Workspace fixture">
      <strong>EduSphere</strong>
    </aside>
    <div className="app-main-column">
      <header className="app-topbar">
        <strong>Academic toolkit</strong>
      </header>
      <div className="app-page-content">
        <ToolsPage />
      </div>
    </div>
  </div>,
);
