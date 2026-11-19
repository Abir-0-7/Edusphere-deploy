import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationApprovalRefSchema, GenerationPreviewSchema, GenerationRunSchema } from '@studyvault/types';
import {
  cancelCourseGeneration,
  getCourseGeneration,
  listCourseGenerations,
  previewCourseGeneration,
  resumeCourseGeneration,
  startCourseGeneration,
} from '../src/lib/course-generation-client';
import { AiHttpError } from '../src/lib/ai-client';

const fixtures: { valid: Record<string, unknown> } = JSON.parse(
  readFileSync(new URL('../../../contracts/course-generation-api.json', import.meta.url), 'utf8'),
);
const data = fixtures.valid;
const reference = GenerationApprovalRefSchema.parse(data.approval_ref);
const preview = GenerationPreviewSchema.parse(data.preview);
const run = GenerationRunSchema.parse(data.pending_run);
const getToken = async () => 'generation-owner';
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

afterEach(() => vi.unstubAllGlobals());

describe('private bounded lesson generation client', () => {
  it('validates saved runs, bounded pages and preview responses with authenticated requests', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(data.list))
      .mockResolvedValueOnce(response(data.pending_run))
      .mockResolvedValueOnce(response(data.preview));
    vi.stubGlobal('fetch', fetch);
    expect((await listCourseGenerations(getToken, 20, 10)).items).toHaveLength(1);
    expect((await getCourseGeneration(getToken, run.id)).id).toBe(run.id);
    expect((await previewCourseGeneration(getToken, reference)).preview_hash).toBe(preview.preview_hash);
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/api/course-generations?limit=10&offset=20');
    expect(String(fetch.mock.calls[1]?.[0])).toBe(`/api/learning-service/api/course-generations/${run.id}`);
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual(reference);
    for (const [, init] of fetch.mock.calls)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer generation-owner');
  });

  it('sends the stable start identity and exact approved preview without client-computed budget authority', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response(data.pending_run));
    vi.stubGlobal('fetch', fetch);
    await startCourseGeneration(getToken, run.id, preview);
    await startCourseGeneration(getToken, run.id, preview);
    const payload = { id: run.id, ...reference, preview_hash: preview.preview_hash, accept_budget: true };
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(payload);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual(payload);
  });

  it('retains the expected revision and explicit remaining-budget acknowledgment on cancel/resume', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(data.cancelled_run))
      .mockResolvedValueOnce(response(data.resumed_run));
    vi.stubGlobal('fetch', fetch);
    await cancelCourseGeneration(getToken, run);
    await resumeCourseGeneration(getToken, run);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ expected_revision: run.revision });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      expected_revision: run.revision,
      accept_remaining_budget: true,
    });
  });

  it('rejects invalid references and unbounded pages before sending any request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    await expect(previewCourseGeneration(getToken, { ...reference, outline_revision: 0 })).rejects.toThrow();
    await expect(startCourseGeneration(getToken, 'not-a-uuid', preview)).rejects.toThrow();
    await expect(listCourseGenerations(getToken, -1)).rejects.toThrow('page size');
    await expect(listCourseGenerations(getToken, 0, 51)).rejects.toThrow('page size');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses publication authority or a completed state without all validated lesson stages', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ ...run, visibility: 'catalog', editorial_status: 'reviewed' }))
      .mockResolvedValueOnce(response({ ...run, status: 'done' }));
    vi.stubGlobal('fetch', fetch);
    await expect(getCourseGeneration(getToken, run.id)).rejects.toThrow('invalid service response');
    await expect(getCourseGeneration(getToken, run.id)).rejects.toThrow('invalid service response');
  });

  it.each([401, 404, 409, 503])(
    'retains status %s so the UI can recover without clearing saved stages',
    async (status) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
        response(
          {
            error: {
              code:
                status === 409
                  ? 'conflict'
                  : status === 401
                    ? 'unauthorized'
                    : status === 404
                      ? 'not_found'
                      : 'internal',
              message: 'Saved generation unavailable',
            },
          },
          status,
        ),
      );
      vi.stubGlobal('fetch', fetch);
      await expect(getCourseGeneration(getToken, run.id)).rejects.toMatchObject({
        status,
        message: 'Saved generation unavailable',
      });
      await expect(getCourseGeneration(getToken, run.id)).rejects.toBeInstanceOf(AiHttpError);
    },
  );
});
