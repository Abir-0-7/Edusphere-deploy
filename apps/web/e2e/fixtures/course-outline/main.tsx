import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CourseOutlinePlanner } from '../../../src/components/course-outline-planner';
import '../../../src/app/globals.css';

function Fixture() {
  const [account, setAccount] = useState(() => localStorage.getItem('outline-fixture-account') ?? 'owner');
  const getToken = useCallback(async () => `outline-fixture-${account}`, [account]);
  return (
    <main className="mx-auto max-w-5xl p-3">
      <label>
        Acceptance account
        <select
          aria-label="Acceptance account"
          value={account}
          onChange={(event) => {
            localStorage.setItem('outline-fixture-account', event.target.value);
            setAccount(event.target.value);
          }}
        >
          <option value="owner">Owner</option>
          <option value="other">Other owner</option>
        </select>
      </label>
      <CourseOutlinePlanner getToken={getToken} accountId={account} />
    </main>
  );
}

const host = document.getElementById('root');
if (!host) throw new Error('Missing outline fixture root');
createRoot(host).render(<Fixture />);
