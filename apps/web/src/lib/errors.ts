/** Shared API error body helpers (mirrors packages/types ErrorSchema). */
export function errorBody(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}
