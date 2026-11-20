import { createRoot } from 'react-dom/client';
import { useCallback, useState } from 'react';
import { OcrWorkspace } from '../../../src/components/ocr-workspace';
import '../../../src/app/globals.css';

function Fixture() {
  const [ownerId, setOwnerId] = useState('ocr-fixture-owner');
  const getToken = useCallback(async () => ownerId, [ownerId]);
  return (
    <main className="mx-auto max-w-xl p-4">
      <label>
        Fixture account
        <select
          aria-label="Fixture account"
          value={ownerId}
          onChange={(event) => setOwnerId(event.target.value)}
        >
          <option>ocr-fixture-owner</option>
          <option>ocr-fixture-other</option>
        </select>
      </label>
      <OcrWorkspace ownerId={ownerId} getToken={getToken} />
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('OCR fixture root is missing');
createRoot(root).render(<Fixture />);
