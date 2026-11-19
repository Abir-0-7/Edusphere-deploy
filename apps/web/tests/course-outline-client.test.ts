import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutlinePlanSchema, OutlineRecordSchema } from '@studyvault/types';
import {
  approveCourseOutline,
  getCourseOutline,
  getOutlineApprovals,
  getOutlineSource,
  listCourseOutlines,
  listOutlineSources,
  saveCourseOutline,
} from '../src/lib/course-outline-client';
import { AiHttpError } from '../src/lib/ai-client';

const fixtures: { valid: Record<string, unknown> } = JSON.parse(
  readFileSync(new URL('../../../contracts/course-outline-api.json', import.meta.url), 'utf8'),
);
const sourceFixtures: { valid: Record<string, unknown> } = JSON.parse(
  readFileSync(new URL('../../../contracts/source-version-api.json', import.meta.url), 'utf8'),
);
const body = fixtures.valid;
const draft = OutlineRecordSchema.parse(body.draft_record);
const getToken = async () => 'outline-owner';
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

afterEach(() => vi.unstubAllGlobals());

describe('private course outline client', () => {
  it('validates sources, drafts and immutable approval history before returning them', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(body.source_list))
      .mockResolvedValueOnce(response(body.outline_list))
      .mockResolvedValueOnce(response(body.draft_record))
      .mockResolvedValueOnce(response(body.approval_list))
      .mockResolvedValueOnce(response(sourceFixtures.valid.pdf_version));
    vi.stubGlobal('fetch', fetch);
    expect((await listOutlineSources(getToken)).items).toHaveLength(2);
    expect((await listCourseOutlines(getToken)).items).toHaveLength(1);
    expect((await getCourseOutline(getToken, draft.id)).id).toBe(draft.id);
    expect((await getOutlineApprovals(getToken, draft.id)).items).toHaveLength(1);
    expect((await getOutlineSource(getToken, 'owned-source')).snapshot.origin.kind).toBe('pdf');
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer outline-owner');
    }
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      '/api/learning-service/api/source-versions?limit=50&offset=0',
    );
  });

  it('sends owner edits with their expected revision and approval with its exact saved hash', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => response(body.draft_record));
    vi.stubGlobal('fetch', fetch);
    const plan = OutlinePlanSchema.parse(body.draft_plan);
    await saveCourseOutline(getToken, draft.id, plan);
    await saveCourseOutline(getToken, draft.id, plan, 3);
    await approveCourseOutline(getToken, draft);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ id: draft.id, plan });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ expected_revision: 3, plan });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      expected_revision: draft.revision,
      content_hash: draft.content_hash,
      reviewed_evidence: true,
    });
  });

  it('rejects a plan whose evidence does not belong to the selected source hash before making a request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    const plan = OutlinePlanSchema.parse(body.ready_plan);
    const pin = plan.objectives[0]?.evidence[0];
    if (!pin) throw new Error('Missing reviewed fixture evidence');
    pin.content_hash = 'f'.repeat(64);
    await expect(saveCourseOutline(getToken, draft.id, plan, draft.revision)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads explicit bounded source/outline pages without an unbounded fetch loop', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(body.source_list))
      .mockResolvedValueOnce(response(body.outline_list));
    vi.stubGlobal('fetch', fetch);
    await listOutlineSources(getToken, 50, 25);
    await listCourseOutlines(getToken, 25, 25);
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/api/source-versions?limit=25&offset=50');
    expect(String(fetch.mock.calls[1]?.[0])).toContain('/api/course-outlines?limit=25&offset=25');
    await expect(listOutlineSources(getToken, -1)).rejects.toThrow('page size');
    await expect(listCourseOutlines(getToken, 0, 51)).rejects.toThrow('page size');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never accepts a catalog/publication shape or an unknown success payload', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ ...draft, visibility: 'catalog', editorial_status: 'reviewed' }))
      .mockResolvedValueOnce(response({ items: [{ id: 'arbitrary' }], total_count: 1 }));
    vi.stubGlobal('fetch', fetch);
    await expect(getCourseOutline(getToken, draft.id)).rejects.toThrow('invalid service response');
    await expect(listCourseOutlines(getToken)).rejects.toThrow('invalid service response');
  });

  it.each([401, 404, 409])(
    'retains status %s so callers can preserve unsaved edits and fail closed',
    async (status) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
        response(
          {
            error: {
              code: status === 409 ? 'conflict' : status === 401 ? 'unauthorized' : 'not_found',
              message: 'Saved revision unavailable',
            },
          },
          status,
        ),
      );
      vi.stubGlobal('fetch', fetch);
      await expect(getCourseOutline(getToken, draft.id)).rejects.toMatchObject({
        status,
        message: 'Saved revision unavailable',
      });
      await expect(getCourseOutline(getToken, draft.id)).rejects.toBeInstanceOf(AiHttpError);
    },
  );
});
