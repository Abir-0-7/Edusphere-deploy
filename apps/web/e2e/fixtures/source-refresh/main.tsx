import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OutlineRecordSchema, type OutlineRecord } from '@studyvault/types';
import { CourseGenerationPanel } from '../../../src/components/course-generation-panel';
import { CourseCatalog } from '../../../src/components/course-catalog';
import { CourseWorkspace } from '../../../src/components/course-workspace';
import { authFetch, readResponse } from '../../../src/lib/ai-client';
import '../../../src/app/globals.css';

const getToken = async () => localStorage.getItem('fixture-learner');

function GenerationWorkspace() {
  const [outline, setOutline] = useState<OutlineRecord | null>(null);
  const [error, setError] = useState('');
  async function refresh() {
    try {
      const response = await authFetch(getToken, '/api/fixture/approved-outline');
      setOutline(await readResponse(response, OutlineRecordSchema, 'fixture outline'));
    } catch (cause) {
      setError(String(cause));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <main className="mx-auto max-w-4xl p-3">
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" onClick={() => void refresh()}>
        Load latest approved fixture outline
      </button>
      <CourseGenerationPanel getToken={getToken} outline={outline} />
    </main>
  );
}

const host = document.getElementById('root');
if (!host) throw new Error('Missing source refresh fixture root');
const url = new URL(window.location.href);
const slug = /^\/courses\/([^/]+)$/.exec(url.pathname)?.[1];
createRoot(host).render(
  slug ? (
    <CourseWorkspace slug={slug} enrollmentId={url.searchParams.get('enrollment')} />
  ) : url.pathname === '/courses' ? (
    <CourseCatalog />
  ) : (
    <GenerationWorkspace />
  ),
);
