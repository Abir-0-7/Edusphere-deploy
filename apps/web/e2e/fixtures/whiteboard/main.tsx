import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WhiteboardWorkspace } from '../../../src/components/whiteboard-workspace';
import '../../../src/app/globals.css';
function Fixture() {
  const [owner, setOwner] = useState('whiteboard-user-a');
  const getToken = useCallback(async () => owner, [owner]);
  return (
    <main>
      <label>
        Fixture account
        <select aria-label="Fixture account" value={owner} onChange={(event) => setOwner(event.target.value)}>
          <option>whiteboard-user-a</option>
          <option>whiteboard-user-b</option>
        </select>
      </label>
      <WhiteboardWorkspace ownerId={owner} getToken={getToken} />
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
createRoot(root).render(<Fixture />);
