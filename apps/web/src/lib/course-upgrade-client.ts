'use client';

import {
  CourseDetailSchema,
  CourseUpgradeApplyRequestSchema,
  CourseUpgradePreviewRequestSchema,
  CourseUpgradePreviewSchema,
  CourseUpgradeResponseSchema,
  type CourseUpgradePreview,
} from '@studyvault/types';
import { learningFetch, readResponse, type GetToken } from './ai-client';

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const path = (id: string) => `/api/course-enrollments/${encodeURIComponent(id)}`;

export async function getPinnedCourse(getToken: GetToken, enrollmentId: string) {
  const response = await learningFetch(getToken, `${path(enrollmentId)}/course`);
  return readResponse(response, CourseDetailSchema, 'pinned course release');
}

export async function previewCourseUpgrade(
  getToken: GetToken,
  enrollmentId: string,
  targetReleaseId: string,
) {
  const body = CourseUpgradePreviewRequestSchema.parse({ target_release_id: targetReleaseId });
  const response = await learningFetch(getToken, `${path(enrollmentId)}/upgrade-preview`, post(body));
  return readResponse(response, CourseUpgradePreviewSchema, 'course upgrade preview');
}

export async function acceptCourseUpgrade(getToken: GetToken, id: string, preview: CourseUpgradePreview) {
  const body = CourseUpgradeApplyRequestSchema.parse({
    id,
    expected_revision: preview.from_revision,
    target_release_id: preview.target_release_id,
    target_content_hash: preview.target_content_hash,
    preview_hash: preview.preview_hash,
    accept_upgrade: true,
  });
  const response = await learningFetch(getToken, `${path(preview.from_enrollment_id)}/upgrade`, post(body));
  return readResponse(response, CourseUpgradeResponseSchema, 'accept course upgrade');
}
