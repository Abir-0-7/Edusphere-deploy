import { describe, expect, it, vi } from 'vitest';
import { CodeReviewResponseSchema } from '@studyvault/types';
import { codeReviewNote, requestCodeReview } from '../src/lib/code-review-client';

const review = CodeReviewResponseSchema.parse({
  time_complexity: 'O(n)',
  space_complexity: 'O(1)',
  explanation: 'Visit all items.',
  assumptions: ['n is item count; bounded per-item cost; worst case.'],
  steps: ['Count n visits.'],
  notes: [{ line: 1, note: 'Traverse the collection.' }],
  improvements: [],
});

describe('qualified static code review', () => {
  it('passes context and abort signal through authenticated shared transport', async () => {
    const controller = new AbortController();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(review)));
    const input = { code: 'for x in values: print(x)', language: 'python', context: 'n is item count' };
    expect(await requestCodeReview(async () => 'owned-token', input, controller.signal)).toEqual(review);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/api/code-review'),
      expect.objectContaining({
        body: JSON.stringify(input),
        signal: controller.signal,
      }),
    );
    const headers = fetcher.mock.calls[0]![1]!.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer owned-token');
    fetcher.mockRestore();
  });

  it('rejects legacy or malformed successful provider output', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ...review, steps: [] })));
    await expect(
      requestCodeReview(async () => 't', { code: 'x=1', language: 'python', context: '' }),
    ).rejects.toThrow('invalid service response');
    fetcher.mockRestore();
  });

  it('keeps provenance and explicit estimate qualifications in editable handoff text', () => {
    const note = codeReviewNote(
      { code: 'print(values)', language: 'python', context: 'worst case', reference: 'Book p. 12' },
      review,
    );
    expect(note).toContain('code was not executed');
    expect(note).toContain('measurements do not prove');
    expect(note).toContain('Learner reference (unverified): Book p. 12');
    expect(note).toContain('Assumptions:');
    expect(note).toContain('Reasoning steps:');
    expect(note).toContain('Line 1:');
  });
});
