import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { CoverBuilder } from '../../../src/components/cover-builder';
import '../../../src/app/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing Cover Builder fixture root');

function Fixture() {
  const [ownerId, setOwnerId] = useState('fixture-cover-learner');
  return (
    <main className="mx-auto max-w-5xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Cover Builder test fixture</h1>
      <label className="mb-4 block text-sm">
        Test account
        <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
          <option value="fixture-cover-learner">Learner A</option>
          <option value="fixture-cover-other">Learner B</option>
        </select>
      </label>
      <CoverBuilder key={ownerId} ownerId={ownerId} />
    </main>
  );
}

createRoot(root).render(<Fixture />);
