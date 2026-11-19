'use client';

import {
  RecommendationRequestSchema,
  RecommendationResponseSchema,
  type RecommendationRequest,
} from '@studyvault/types';
import { learningFetch, readResponse, type GetToken } from './ai-client';

export async function getRecommendations(getToken: GetToken, input: RecommendationRequest = {}) {
  const body = RecommendationRequestSchema.parse(input);
  const response = await learningFetch(getToken, '/api/learner-profile/recommendations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(response, RecommendationResponseSchema, 'Load recommendations');
}
