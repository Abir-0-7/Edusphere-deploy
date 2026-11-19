import { createRoot } from 'react-dom/client';
import ReviewPage from '../../../src/app/(protected)/review/page';
import { CourseCatalog } from '../../../src/components/course-catalog';
import { CourseWorkspace } from '../../../src/components/course-workspace';
import '../../../src/app/globals.css';

const host = document.getElementById('root');
if (!host) throw new Error('Missing course candidate fixture root');
const url = new URL(window.location.href);
const slug = /^\/courses\/([^/]+)$/.exec(url.pathname)?.[1];
createRoot(host).render(
  slug ? (
    <CourseWorkspace slug={slug} enrollmentId={url.searchParams.get('enrollment')} />
  ) : url.pathname === '/review' ? (
    <ReviewPage />
  ) : (
    <CourseCatalog />
  ),
);
