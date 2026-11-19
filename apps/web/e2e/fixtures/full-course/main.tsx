import { createRoot } from 'react-dom/client';
import { CourseWorkspace } from '../../../src/components/course-workspace';
import { CourseCatalog } from '../../../src/components/course-catalog';
import '../../../src/app/globals.css';

const host = document.getElementById('root');
if (!host) throw new Error('Missing full course fixture root');
const url = new URL(window.location.href);
const slug = /^\/courses\/([^/]+)$/.exec(url.pathname)?.[1];
createRoot(host).render(
  <>
    <p className="border-b bg-amber-50 p-3 text-center text-sm">
      Local acceptance fixture · repository course approved, no deployment
    </p>
    {slug ? (
      <CourseWorkspace slug={slug} enrollmentId={url.searchParams.get('enrollment')} />
    ) : (
      <CourseCatalog />
    )}
  </>,
);
