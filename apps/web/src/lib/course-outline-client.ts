'use client';

import {
  LocalTextImportSchema,
  OutlineApprovalListResponseSchema,
  OutlineApproveRequestSchema,
  OutlineCreateRequestSchema,
  OutlineDeleteResponseSchema,
  OutlineListResponseSchema,
  OutlineRecordSchema,
  OutlineSourceListResponseSchema,
  OutlineUpdateRequestSchema,
  SourceVersionSchema,
  type LocalTextImport,
  type OutlinePlan,
  type OutlineRecord,
} from '@studyvault/types';
import { learningFetch, readResponse, type GetToken } from './ai-client';

const json = (method: 'POST' | 'PUT', body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function pagination(offset: number, limit: number) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new Error('Choose an outline page size from 1 to 50 and a nonnegative offset.');
  }
  return `limit=${limit}&offset=${offset}`;
}

export async function listOutlineSources(getToken: GetToken, offset = 0, limit = 50) {
  const response = await learningFetch(getToken, `/api/source-versions?${pagination(offset, limit)}`);
  return readResponse(response, OutlineSourceListResponseSchema, 'outline sources');
}

export async function getOutlineSource(getToken: GetToken, id: string) {
  const response = await learningFetch(getToken, `/api/source-versions/${encodeURIComponent(id)}`);
  return readResponse(response, SourceVersionSchema, 'source version');
}

export async function preparePdfOutlineSource(getToken: GetToken, documentId: string) {
  const response = await learningFetch(
    getToken,
    `/api/documents/${encodeURIComponent(documentId)}/source-versions`,
    json('POST', {}),
  );
  return readResponse(response, SourceVersionSchema, 'PDF source preparation');
}

export async function importLocalOutlineSource(
  getToken: GetToken,
  body: LocalTextImport,
  signal: AbortSignal,
) {
  const response = await learningFetch(getToken, '/api/source-versions/import-text', {
    ...json('POST', LocalTextImportSchema.parse(body)),
    signal,
  });
  return readResponse(response, SourceVersionSchema, 'local source import');
}

export async function listCourseOutlines(getToken: GetToken, offset = 0, limit = 50) {
  const response = await learningFetch(getToken, `/api/course-outlines?${pagination(offset, limit)}`);
  return readResponse(response, OutlineListResponseSchema, 'saved outlines');
}

export async function getCourseOutline(getToken: GetToken, id: string) {
  const response = await learningFetch(getToken, `/api/course-outlines/${encodeURIComponent(id)}`);
  return readResponse(response, OutlineRecordSchema, 'saved outline');
}

export async function saveCourseOutline(
  getToken: GetToken,
  id: string,
  plan: OutlinePlan,
  revision?: number,
) {
  const body =
    revision === undefined
      ? OutlineCreateRequestSchema.parse({ id, plan })
      : OutlineUpdateRequestSchema.parse({ expected_revision: revision, plan });
  const response = await learningFetch(
    getToken,
    revision === undefined ? '/api/course-outlines' : `/api/course-outlines/${encodeURIComponent(id)}`,
    json(revision === undefined ? 'POST' : 'PUT', body),
  );
  return readResponse(response, OutlineRecordSchema, 'outline save');
}

export async function approveCourseOutline(getToken: GetToken, record: OutlineRecord) {
  const body = OutlineApproveRequestSchema.parse({
    expected_revision: record.revision,
    content_hash: record.content_hash,
    reviewed_evidence: true,
  });
  const response = await learningFetch(
    getToken,
    `/api/course-outlines/${encodeURIComponent(record.id)}/approve`,
    json('POST', body),
  );
  return readResponse(response, OutlineRecordSchema, 'outline approval');
}

export async function getOutlineApprovals(getToken: GetToken, id: string) {
  const response = await learningFetch(getToken, `/api/course-outlines/${encodeURIComponent(id)}/approvals`);
  return readResponse(response, OutlineApprovalListResponseSchema, 'outline approval history');
}

export async function deleteCourseOutline(getToken: GetToken, id: string) {
  const response = await learningFetch(getToken, `/api/course-outlines/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await readResponse(response, OutlineDeleteResponseSchema, 'outline deletion');
}
