import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DraftChecklistWorkspace } from '../../../src/components/draft-checklist-workspace';
import '../../../src/app/globals.css';
function Fixture() {
  const [ownerId, setOwnerId] = useState('checklist-a');
  const getToken = useCallback(async () => ownerId, [ownerId]);
  return (
    <main className="mx-auto max-w-2xl p-4">
      <label>
        Fixture account
        <select
          aria-label="Fixture account"
          value={ownerId}
          onChange={(event) => setOwnerId(event.target.value)}
        >
          <option>checklist-a</option>
          <option>checklist-b</option>
        </select>
      </label>
      <DraftChecklistWorkspace ownerId={ownerId} getToken={getToken} />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
