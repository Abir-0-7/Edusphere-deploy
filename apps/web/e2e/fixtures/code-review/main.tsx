import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CodeReviewWorkspace } from '../../../src/components/code-review-workspace';
import '../../../src/app/globals.css';

function Fixture() {
  const [owner, setOwner] = useState('learner-a');
  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4">
      <button type="button" onClick={() => setOwner(owner === 'learner-a' ? 'learner-b' : 'learner-a')}>
        Switch fixture account
      </button>
      <p>Account: {owner}</p>
      <CodeReviewWorkspace key={owner} ownerId={owner} getToken={async () => owner} />
    </main>
  );
}
const host = document.getElementById('root');
if (!host) throw new Error('Missing fixture host');
createRoot(host).render(<Fixture />);
