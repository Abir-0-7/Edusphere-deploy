import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { documents } from '@studyvault/db';
import { GET } from '../src/app/api/documents/[id]/text/route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<{ userId: string | null }>>(),
  getUserByClerkId: vi.fn<(clerkId: string) => Promise<{ id: string } | null>>(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('@/lib/users', () => ({ getUserByClerkId: mocks.getUserByClerkId }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ select: mocks.select }) }));
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual, eq: vi.fn(actual.eq) };
});

const documentId = '11111111-1111-4111-8111-111111111111';
const internalUserId = '22222222-2222-4222-8222-222222222222';
const request = new Request(`https://studyvault.example/api/documents/${documentId}/text`);

function download(id = documentId) {
  return GET(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'user_clerk_owner' });
  mocks.getUserByClerkId.mockResolvedValue({ id: internalUserId });
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ limit: mocks.limit });
  mocks.limit.mockResolvedValue([{ markdown: '# Lecture\nA helpful study note.' }]);
});

describe('document text download', () => {
  it('requires a Clerk session before querying user data', async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const response = await download();

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('unauthorized');
    expect(mocks.getUserByClerkId).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('returns a generic not-found response for a document owned by someone else', async () => {
    mocks.limit.mockResolvedValue([]);
    const response = await download();

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('not_found');
    expect(eq).toHaveBeenCalledWith(documents.id, documentId);
    expect(eq).toHaveBeenCalledWith(documents.userId, internalUserId);
    expect(mocks.getUserByClerkId).toHaveBeenCalledWith('user_clerk_owner');
  });

  it('does not query documents until the app user exists', async () => {
    mocks.getUserByClerkId.mockResolvedValue(null);
    const response = await download();

    expect(response.status).toBe(404);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each([null, '', '   '])('reports that text is not ready when the stored text is %j', async (markdown) => {
    mocks.limit.mockResolvedValue([{ markdown }]);
    const response = await download();

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('invalid_input');
    expect(response.headers.get('content-disposition')).toBeNull();
  });

  it('downloads stored markdown as private plain text with a safe generic filename', async () => {
    const response = await download();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('# Lecture\nA helpful study note.');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="edusphere-notes.txt"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects malformed identifiers before querying documents', async () => {
    const response = await download('not-a-uuid');

    expect(response.status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
