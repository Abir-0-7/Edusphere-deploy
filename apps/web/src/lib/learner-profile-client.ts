'use client';

import {
  LearnerDiagnosticDefinitionSchema,
  LearnerDiagnosticRequestSchema,
  LearnerProfileInputSchema,
  LearnerProfileResponseSchema,
  type LearnerDiagnosticRequest,
  type LearnerProfileInput,
} from '@studyvault/types';
import { learningFetch, readResponse, type GetToken } from './ai-client';

export async function getLearnerProfile(getToken: GetToken) {
  const response = await learningFetch(getToken, '/api/learner-profile', { cache: 'no-store' });
  return readResponse(response, LearnerProfileResponseSchema, 'Load learning profile');
}

export async function saveLearnerProfile(getToken: GetToken, input: LearnerProfileInput) {
  const body = LearnerProfileInputSchema.parse(input);
  const response = await learningFetch(getToken, '/api/learner-profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(response, LearnerProfileResponseSchema, 'Save learning profile');
}

export async function getLearnerDiagnostic(getToken: GetToken) {
  const response = await learningFetch(getToken, '/api/learner-profile/diagnostic');
  return readResponse(response, LearnerDiagnosticDefinitionSchema, 'Load optional diagnostic');
}

export async function submitLearnerDiagnostic(getToken: GetToken, input: LearnerDiagnosticRequest) {
  const body = LearnerDiagnosticRequestSchema.parse(input);
  const response = await learningFetch(getToken, '/api/learner-profile/diagnostic', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(response, LearnerProfileResponseSchema, 'Save optional diagnostic');
}
