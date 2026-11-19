import { CourseWorkspace } from '@/components/course-workspace';

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ enrollment?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const enrollmentId = Array.isArray(query.enrollment) ? query.enrollment[0] : query.enrollment;
  return <CourseWorkspace slug={slug} enrollmentId={enrollmentId ?? null} />;
}
