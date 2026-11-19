'use client';

import {
  BibliographyDeleteResponseSchema,
  BibliographyItemInputSchema,
  BibliographyItemSchema,
  BibliographyListResponseSchema,
  BibliographyItemUpdateSchema,
  LibraryDocumentListResponseSchema,
  type BibliographyItem,
  type BibliographyItemInput,
  type BibliographyItemUpdate,
  type LibraryDocument,
} from '@studyvault/types';
import { learningFetch, readResponse, type GetToken } from './ai-client';

const json = (method: 'POST' | 'PUT', body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export async function listBibliographyItems(getToken: GetToken): Promise<BibliographyItem[]> {
  const items: BibliographyItem[] = [];
  let offset = 0;
  let total = 0;
  do {
    const response = await learningFetch(getToken, `/api/bibliography?limit=100&offset=${offset}`);
    const data = await readResponse(response, BibliographyListResponseSchema, 'bibliography list');
    items.push(...data.items);
    total = data.total_count;
    offset += data.items.length;
    if (data.items.length === 0) break;
  } while (offset < total);
  return items;
}

export async function listLibraryDocuments(getToken: GetToken): Promise<LibraryDocument[]> {
  const response = await learningFetch(getToken, '/api/bibliography/library-documents?limit=100&offset=0');
  const data = await readResponse(response, LibraryDocumentListResponseSchema, 'library document list');
  return data.documents;
}

export async function createBibliographyItem(
  getToken: GetToken,
  input: BibliographyItemInput,
): Promise<BibliographyItem> {
  const body = BibliographyItemInputSchema.parse(input);
  const response = await learningFetch(getToken, '/api/bibliography', json('POST', body));
  return readResponse(response, BibliographyItemSchema, 'bibliography save');
}

export async function updateBibliographyItem(
  getToken: GetToken,
  id: string,
  input: BibliographyItemUpdate,
): Promise<BibliographyItem> {
  const body = BibliographyItemUpdateSchema.parse(input);
  const response = await learningFetch(
    getToken,
    `/api/bibliography/${encodeURIComponent(id)}`,
    json('PUT', body),
  );
  return readResponse(response, BibliographyItemSchema, 'bibliography update');
}

export async function deleteBibliographyItem(getToken: GetToken, id: string): Promise<void> {
  const response = await learningFetch(getToken, `/api/bibliography/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await readResponse(response, BibliographyDeleteResponseSchema, 'bibliography delete');
}
