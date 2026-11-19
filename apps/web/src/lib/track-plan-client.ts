'use client';

import {
  TrackCatalogResponseSchema,
  TrackChangeAppliedSchema,
  TrackChangeApplyRequestSchema,
  TrackChangePreviewSchema,
  TrackChangeRequestSchema,
  TrackPlanHistoryResponseSchema,
  type TrackChangePreview,
  type TrackId,
} from '@studyvault/types';
import { learningFetch, readResponse, type GetToken } from './ai-client';

const BASE = '/api/learner-profile/track-plan';
const json = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

export async function getTrackOptions(getToken: GetToken) {
  const res = await learningFetch(getToken, `${BASE}/options`, { cache: 'no-store' });
  return readResponse(res, TrackCatalogResponseSchema, 'Load learning tracks');
}

export async function previewTrackChange(getToken: GetToken, targetTrack: TrackId) {
  const body = TrackChangeRequestSchema.parse({ target_track_id: targetTrack });
  const res = await learningFetch(getToken, `${BASE}/preview`, json(body));
  return readResponse(res, TrackChangePreviewSchema, 'Preview learning track');
}

export async function applyTrackChange(getToken: GetToken, preview: TrackChangePreview) {
  const body = TrackChangeApplyRequestSchema.parse({
    target_track_id: preview.target_track_id,
    expected_revision: preview.expected_revision,
    preview_id: preview.preview_id,
  });
  const res = await learningFetch(getToken, `${BASE}/apply`, json(body));
  return readResponse(res, TrackChangeAppliedSchema, 'Save learning track');
}

export async function getTrackHistory(getToken: GetToken, beforeRevision?: number) {
  const suffix = beforeRevision === undefined ? '' : `?before_revision=${beforeRevision}`;
  const res = await learningFetch(getToken, `${BASE}/history${suffix}`, { cache: 'no-store' });
  return readResponse(res, TrackPlanHistoryResponseSchema, 'Load track history');
}
