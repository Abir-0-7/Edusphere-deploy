import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OutlineRecordSchema, type OutlineRecord } from '@studyvault/types';
import { CourseGenerationPanel } from '../../../src/components/course-generation-panel';
import { authFetch, readResponse, type GetToken } from '../../../src/lib/ai-client';
import '../../../src/app/globals.css';

function OwnerWorkspace({ getToken }: { getToken: GetToken }) {
  const [outline, setOutline] = useState<OutlineRecord | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void authFetch(getToken, '/api/fixture/approved-outline')
      .then((response) => readResponse(response, OutlineRecordSchema, 'fixture outline'))
      .then((data) => {
        if (active) setOutline(data);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [getToken]);
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      <CourseGenerationPanel getToken={getToken} outline={outline} />
    </>
  );
}

function Fixture() {
  const [account, setAccount] = useState(() => localStorage.getItem('generation-fixture-account') ?? 'owner');
  const getToken = useCallback(async () => `generation-fixture-${account}`, [account]);
  return (
    <main className="mx-auto max-w-4xl p-3">
      <label>
        Acceptance account
        <select
          aria-label="Acceptance account"
          value={account}
          onChange={(event) => {
            localStorage.setItem('generation-fixture-account', event.target.value);
            setAccount(event.target.value);
          }}
        >
          <option value="owner">Owner</option>
          <option value="other">Other owner</option>
          <option value={account}>{account}</option>
        </select>
      </label>
      <OwnerWorkspace key={account} getToken={getToken} />
    </main>
  );
}

const host = document.getElementById('root');
if (!host) throw new Error('Missing generation fixture root');
createRoot(host).render(<Fixture />);
