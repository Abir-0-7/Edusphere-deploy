import {
  CodeReviewRequestSchema,
  CodeReviewResponseSchema,
  type CodeReviewResponse,
} from '@studyvault/types';
import { authFetch, readResponse, type GetToken } from './ai-client';

export async function requestCodeReview(
  getToken: GetToken,
  input: { code: string; language: string; context: string },
  signal?: AbortSignal,
): Promise<CodeReviewResponse> {
  const body = CodeReviewRequestSchema.parse(input);
  const response = await authFetch(getToken, '/api/code-review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return readResponse(response, CodeReviewResponseSchema, 'code review');
}

/** Plain text, owned note draft. References are supplied by the learner, never invented by AI. */
export function codeReviewNote(
  input: { code: string; language: string; context: string; reference: string },
  review: CodeReviewResponse,
): string {
  return [
    `Big-O review — ${input.language} (static estimate; code was not executed)`,
    `Time: ${review.time_complexity}; space: ${review.space_complexity}`,
    'Finite runtime measurements do not prove an asymptotic bound.',
    input.context.trim() ? `Learner context: ${input.context.trim()}` : '',
    input.reference.trim() ? `Learner reference (unverified): ${input.reference.trim()}` : '',
    `Code:\n${input.code}`,
    `Explanation:\n${review.explanation}`,
    `Assumptions:\n${review.assumptions.map((text) => `- ${text}`).join('\n')}`,
    `Reasoning steps:\n${review.steps.map((text, index) => `${index + 1}. ${text}`).join('\n')}`,
    review.notes.length
      ? `Line notes:\n${review.notes.map((note) => `${note.line === null ? 'General' : `Line ${note.line}`}: ${note.note}`).join('\n')}`
      : '',
    review.improvements.length
      ? `Possible improvements:\n${review.improvements.map((text) => `- ${text}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
