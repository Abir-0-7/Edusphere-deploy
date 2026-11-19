'use client';

import {
  GenerationActionRequestSchema,
  GenerationApprovalRefSchema,
  GenerationListResponseSchema,
  GenerationPreviewSchema,
  GenerationResumeRequestSchema,
  GenerationRunSchema,
  GenerationStartRequestSchema,
  type GenerationApprovalRef,
  type GenerationPreview,
  type GenerationRun,
} from '@studyvault/types';
import { learningFetch, readResponse, type GetToken } from './ai-client';

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const runPath = (id: string) => `/api/course-generations/${encodeURIComponent(id)}`;

export async function listCourseGenerations(getToken: GetToken, offset = 0, limit = 20) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new Error('Choose a generation page size from 1 to 50 and a nonnegative offset.');
  }
  const response = await learningFetch(getToken, `/api/course-generations?limit=${limit}&offset=${offset}`);
  return readResponse(response, GenerationListResponseSchema, 'saved lesson drafts');
}

export async function previewCourseGeneration(getToken: GetToken, approval: GenerationApprovalRef) {
  const body = GenerationApprovalRefSchema.parse(approval);
  const response = await learningFetch(getToken, '/api/course-generations/preview', post(body));
  return readResponse(response, GenerationPreviewSchema, 'lesson generation preview');
}

export async function startCourseGeneration(getToken: GetToken, id: string, preview: GenerationPreview) {
  const body = GenerationStartRequestSchema.parse({
    id,
    outline_id: preview.outline_id,
    approval_id: preview.approval_id,
    outline_revision: preview.outline_revision,
    outline_content_hash: preview.outline_content_hash,
    preview_hash: preview.preview_hash,
    accept_budget: true,
  });
  const response = await learningFetch(getToken, '/api/course-generations', post(body));
  return readResponse(response, GenerationRunSchema, 'start lesson generation');
}

export async function getCourseGeneration(getToken: GetToken, id: string) {
  const response = await learningFetch(getToken, runPath(id));
  return readResponse(response, GenerationRunSchema, 'lesson generation progress');
}

export async function cancelCourseGeneration(getToken: GetToken, run: GenerationRun) {
  const body = GenerationActionRequestSchema.parse({ expected_revision: run.revision });
  const response = await learningFetch(getToken, `${runPath(run.id)}/cancel`, post(body));
  return readResponse(response, GenerationRunSchema, 'cancel lesson generation');
}

export async function resumeCourseGeneration(getToken: GetToken, run: GenerationRun) {
  const body = GenerationResumeRequestSchema.parse({
    expected_revision: run.revision,
    accept_remaining_budget: true,
  });
  const response = await learningFetch(getToken, `${runPath(run.id)}/resume`, post(body));
  return readResponse(response, GenerationRunSchema, 'resume lesson generation');
}
