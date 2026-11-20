'use client';

import {
  CurrentFocusSessionResponseSchema,
  DashboardResponseSchema,
  ExamPlanResponseSchema,
  FocusCompletionResponseSchema,
  FocusSessionResponseSchema,
  FocusStartRequestSchema,
  ReadinessResponseSchema,
  SavedStudyPlanResponseSchema,
  StudyPlanRequestSchema,
  TokenBalanceResponseSchema,
  WeeklyAdviceResponseSchema,
} from '@studyvault/types';
import { authFetch, readResponse, type GetToken } from './ai-client';

export async function startFocusSession(getToken: GetToken, kind: string, plannedSeconds?: number) {
  const body = FocusStartRequestSchema.parse({
    kind,
    ...(plannedSeconds === undefined ? {} : { planned_seconds: plannedSeconds }),
  });
  const response = await authFetch(getToken, '/api/focus-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(response, FocusSessionResponseSchema, 'focus session');
}

export async function getCurrentFocusSession(getToken: GetToken) {
  return readResponse(
    await authFetch(getToken, '/api/focus-sessions/current', { cache: 'no-store' }),
    CurrentFocusSessionResponseSchema,
    'focus restoration',
  );
}

export async function completeFocusSession(getToken: GetToken, sessionId: string) {
  return readResponse(
    await authFetch(getToken, `/api/focus-sessions/${sessionId}/complete`, { method: 'POST' }),
    FocusCompletionResponseSchema,
    'focus completion',
  );
}

export async function getTokenBalance(getToken: GetToken) {
  return readResponse(
    await authFetch(getToken, '/api/tokens/balance', { cache: 'no-store' }),
    TokenBalanceResponseSchema,
    'token balance',
  );
}

export async function getDashboard(getToken: GetToken) {
  return readResponse(await authFetch(getToken, '/api/dashboard'), DashboardResponseSchema, 'progress');
}

export async function getReadiness(getToken: GetToken) {
  return readResponse(await authFetch(getToken, '/api/readiness'), ReadinessResponseSchema, 'readiness');
}

export async function getWeeklyAdvice(getToken: GetToken) {
  return readResponse(
    await authFetch(getToken, '/api/advice/weekly'),
    WeeklyAdviceResponseSchema,
    'weekly advice',
  );
}

export async function createStudyPlan(
  getToken: GetToken,
  documentId: string,
  examDate: string,
  minutesPerDay = 60,
) {
  const body = StudyPlanRequestSchema.parse({ exam_date: examDate, minutes_per_day: minutesPerDay });
  const response = await authFetch(getToken, `/api/documents/${documentId}/study-plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(response, ExamPlanResponseSchema, 'study planner');
}

export async function getStudyPlan(getToken: GetToken, documentId: string) {
  return readResponse(
    await authFetch(getToken, `/api/documents/${documentId}/study-plan`),
    SavedStudyPlanResponseSchema,
    'saved study plan',
  );
}
