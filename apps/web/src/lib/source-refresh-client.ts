'use client';

import {
  GenerationRunSchema,
  LessonEditListResponseSchema,
  LessonEditRequestSchema,
  GenerationLessonEditSchema,
  RefreshPreviewRequestSchema,
  RefreshPreviewSchema,
  RefreshStartRequestSchema,
  SourceImpactRequestSchema,
  SourceImpactResponseSchema,
  type GenerationRun,
  type LessonDraft,
  type RefreshPreviewRequest,
  type RefreshPreview,
} from '@studyvault/types';
import { learningFetch, readResponse, type GetToken } from './ai-client';

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export async function previewSourceImpact(
  getToken: GetToken,
  oldVersionId: string,
  newVersionId: string,
  offset = 0,
) {
  const body = SourceImpactRequestSchema.parse({
    old_version_id: oldVersionId,
    new_version_id: newVersionId,
    limit: 20,
    offset,
  });
  const response = await learningFetch(getToken, '/api/source-refresh/impact', json(body));
  return readResponse(response, SourceImpactResponseSchema, 'source impact preview');
}

export async function previewGenerationRefresh(getToken: GetToken, request: RefreshPreviewRequest) {
  const body = RefreshPreviewRequestSchema.parse(request);
  const response = await learningFetch(getToken, '/api/course-generations/refresh/preview', json(body));
  return readResponse(response, RefreshPreviewSchema, 'selective lesson refresh preview');
}

export async function startGenerationRefresh(
  getToken: GetToken,
  id: string,
  request: RefreshPreviewRequest,
  preview: RefreshPreview,
) {
  const body = RefreshStartRequestSchema.parse({
    ...request,
    id,
    preview_hash: preview.preview_hash,
    accept_budget: true,
  });
  const response = await learningFetch(getToken, '/api/course-generations/refresh', json(body));
  return readResponse(response, GenerationRunSchema, 'start selective lesson refresh');
}

export async function getLessonEdits(getToken: GetToken, runId: string) {
  const response = await learningFetch(
    getToken,
    `/api/course-generations/${encodeURIComponent(runId)}/lesson-edits`,
  );
  return readResponse(response, LessonEditListResponseSchema, 'saved lesson edit history');
}

export async function saveLessonEdit(
  getToken: GetToken,
  run: GenerationRun,
  objectiveId: string,
  revision: number,
  output: LessonDraft,
) {
  const body = LessonEditRequestSchema.parse({
    expected_run_revision: run.revision,
    expected_edit_revision: revision,
    output,
  });
  const response = await learningFetch(
    getToken,
    `/api/course-generations/${encodeURIComponent(run.id)}/lessons/${encodeURIComponent(objectiveId)}`,
    json(body, 'PUT'),
  );
  return readResponse(response, GenerationLessonEditSchema, 'save private lesson edit');
}
