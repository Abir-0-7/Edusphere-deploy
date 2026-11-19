import { z } from 'zod';
import {
  AcademicCoverDraftSchema,
  CoverTemplateIdSchema,
  type AcademicCoverDraft,
  type AcademicCoverContent,
} from '@studyvault/types';
import { validateCoverLogo, type CoverLogoAsset } from './cover-pdf';

const DATABASE_NAME = 'studyvault-cover-vault-v1';
const DATABASE_VERSION = 1;
const DRAFT_STORE = 'drafts';
const PRESET_STORE = 'presets';
const ARTIFACT_STORE = 'artifacts';
const MAX_DRAFTS = 12;
const MAX_PRESETS = 20;
const MAX_ARTIFACTS = 5;
const MAX_PDF_BYTES = 4 * 1024 * 1024;

export const InstitutionPresetValuesSchema = z.object({
  templateId: CoverTemplateIdSchema,
  pageSize: z.enum(['a4', 'letter']),
  institutionName: z.string().trim().max(240),
  department: z.string().trim().max(240),
  courseCode: z.string().trim().max(80),
  courseName: z.string().trim().max(240),
  instructorName: z.string().trim().max(200),
});
export type InstitutionPresetValues = z.infer<typeof InstitutionPresetValuesSchema>;

const LogoAssetSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  mimeType: z.enum(['image/png', 'image/jpeg']),
  width: z.number().int().positive().max(2400),
  height: z.number().int().positive().max(2400),
});

const SavedCoverDraftSchema = z.object({
  recordVersion: z.literal(1),
  id: z.string().uuid(),
  ownerId: z.string().min(1).max(256),
  revision: z.number().int().positive(),
  name: z.string().min(1).max(400),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  draft: AcademicCoverDraftSchema,
  logo: LogoAssetSchema.nullable(),
});
export type SavedCoverDraft = z.infer<typeof SavedCoverDraftSchema>;

const SavedInstitutionPresetSchema = z.object({
  recordVersion: z.literal(1),
  id: z.string().uuid(),
  ownerId: z.string().min(1).max(256),
  revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(80),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  values: InstitutionPresetValuesSchema,
});
export type SavedInstitutionPreset = z.infer<typeof SavedInstitutionPresetSchema>;

const SavedCoverArtifactSchema = z.object({
  recordVersion: z.literal(1),
  id: z.string().uuid(),
  ownerId: z.string().min(1).max(256),
  createdAt: z.string().datetime(),
  fileName: z.string().min(1).max(100),
  templateId: CoverTemplateIdSchema,
  templateVersion: z.literal(1),
  pageSize: z.enum(['a4', 'letter']),
  draftRevision: z.number().int().positive().nullable(),
  draft: AcademicCoverDraftSchema,
  logo: LogoAssetSchema.nullable(),
  pdfBytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= MAX_PDF_BYTES),
});
export type SavedCoverArtifact = z.infer<typeof SavedCoverArtifactSchema>;

export type CoverVaultOptions = {
  databaseName?: string;
  factory?: IDBFactory;
};

function requireOwner(ownerId: string) {
  if (!ownerId.trim() || ownerId.length > 256) throw new Error('Sign in to save private cover work.');
}

function databaseFactory(options: CoverVaultOptions): IDBFactory {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('This browser does not support local cover storage.');
  return factory;
}

function openDatabase(options: CoverVaultOptions = {}): Promise<IDBDatabase> {
  const factory = databaseFactory(options);
  return new Promise((resolve, reject) => {
    const request = factory.open(options.databaseName ?? DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of [DRAFT_STORE, PRESET_STORE, ARTIFACT_STORE]) {
        if (!database.objectStoreNames.contains(name)) {
          const store = database.createObjectStore(name, { keyPath: ['ownerId', 'id'] });
          store.createIndex('ownerId', 'ownerId', { unique: false });
          store.createIndex('updatedAt', ['ownerId', 'updatedAt'], { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open private cover storage.'));
    request.onblocked = () => reject(new Error('Private cover storage is busy in another tab.'));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Private cover storage request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Private cover storage transaction aborted.'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Private cover storage transaction failed.'));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  options: CoverVaultOptions,
  run: (store: IDBObjectStore, transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const database = await openDatabase(options);
  try {
    const transaction = database.transaction(storeName, mode);
    const completed = transactionComplete(transaction);
    const result = await run(transaction.objectStore(storeName), transaction);
    await completed;
    return result;
  } finally {
    database.close();
  }
}

function ownerRange(ownerId: string): IDBKeyRange {
  return IDBKeyRange.bound([ownerId, ''], [ownerId, '\uffff']);
}

function validateLogo(logo: CoverLogoAsset | null | undefined): CoverLogoAsset | null {
  if (!logo) return null;
  return validateCoverLogo(logo.bytes, logo.mimeType);
}

function id() {
  return globalThis.crypto.randomUUID();
}

function newestFirst<T extends { updatedAt: string }>(records: T[]) {
  return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function listCoverDrafts(ownerId: string, options: CoverVaultOptions = {}) {
  requireOwner(ownerId);
  return withStore(DRAFT_STORE, 'readonly', options, async (store) => {
    const raw = await requestValue(store.getAll(ownerRange(ownerId)));
    return newestFirst(raw.map((item) => SavedCoverDraftSchema.parse(item)));
  });
}

export async function getCoverDraft(ownerId: string, draftId: string, options: CoverVaultOptions = {}) {
  requireOwner(ownerId);
  return withStore(DRAFT_STORE, 'readonly', options, async (store) => {
    const raw = await requestValue(store.get([ownerId, draftId]));
    if (raw === undefined) return null;
    const record = SavedCoverDraftSchema.parse(raw);
    if (record.ownerId !== ownerId) throw new Error('Saved cover belongs to a different account.');
    return record;
  });
}

export async function saveCoverDraft(
  ownerId: string,
  draftInput: unknown,
  logo?: CoverLogoAsset | null,
  draftId?: string,
  options: CoverVaultOptions = {},
): Promise<SavedCoverDraft> {
  requireOwner(ownerId);
  const draft = AcademicCoverDraftSchema.parse(draftInput);
  const cleanLogo = validateLogo(logo);
  const recordId = draftId ?? id();
  return withStore(DRAFT_STORE, 'readwrite', options, async (store) => {
    const raw = await requestValue(store.getAll(ownerRange(ownerId)));
    const records = raw.map((item) => SavedCoverDraftSchema.parse(item));
    const prior = draftId ? records.find((record) => record.id === draftId) : undefined;
    if (draftId && !prior) throw new Error('Saved cover was removed or belongs to another account.');
    const now = new Date().toISOString();
    const saved = SavedCoverDraftSchema.parse({
      recordVersion: 1,
      id: recordId,
      ownerId,
      revision: (prior?.revision ?? 0) + 1,
      name: draft.content.title,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      draft,
      logo: cleanLogo,
    });
    if (!prior && records.length >= MAX_DRAFTS) {
      const oldest = records.reduce((a, b) => (a.updatedAt < b.updatedAt ? a : b));
      await requestValue(store.delete([ownerId, oldest.id]));
    }
    await requestValue(store.put(saved));
    return saved;
  });
}

export async function deleteCoverDraft(ownerId: string, draftId: string, options: CoverVaultOptions = {}) {
  requireOwner(ownerId);
  return withStore(DRAFT_STORE, 'readwrite', options, async (store) => {
    const raw = await requestValue(store.get([ownerId, draftId]));
    if (raw !== undefined) await requestValue(store.delete([ownerId, draftId]));
  });
}

export async function listInstitutionPresets(ownerId: string, options: CoverVaultOptions = {}) {
  requireOwner(ownerId);
  return withStore(PRESET_STORE, 'readonly', options, async (store) => {
    const raw = await requestValue(store.getAll(ownerRange(ownerId)));
    return newestFirst(raw.map((item) => SavedInstitutionPresetSchema.parse(item)));
  });
}

export async function saveInstitutionPreset(
  ownerId: string,
  name: string,
  valuesInput: unknown,
  presetId?: string,
  options: CoverVaultOptions = {},
): Promise<SavedInstitutionPreset> {
  requireOwner(ownerId);
  const values = InstitutionPresetValuesSchema.parse(valuesInput);
  const cleanName = z.string().trim().min(1).max(80).parse(name);
  const recordId = presetId ?? id();
  return withStore(PRESET_STORE, 'readwrite', options, async (store) => {
    const raw = await requestValue(store.getAll(ownerRange(ownerId)));
    const records = raw.map((item) => SavedInstitutionPresetSchema.parse(item));
    const prior = presetId ? records.find((record) => record.id === presetId) : undefined;
    if (presetId && !prior) throw new Error('Saved preset was removed or belongs to another account.');
    const now = new Date().toISOString();
    const saved = SavedInstitutionPresetSchema.parse({
      recordVersion: 1,
      id: recordId,
      ownerId,
      revision: (prior?.revision ?? 0) + 1,
      name: cleanName,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      values,
    });
    if (!prior && records.length >= MAX_PRESETS) {
      const oldest = records.reduce((a, b) => (a.updatedAt < b.updatedAt ? a : b));
      await requestValue(store.delete([ownerId, oldest.id]));
    }
    await requestValue(store.put(saved));
    return saved;
  });
}

export async function deleteInstitutionPreset(
  ownerId: string,
  presetId: string,
  options: CoverVaultOptions = {},
) {
  requireOwner(ownerId);
  return withStore(PRESET_STORE, 'readwrite', options, async (store) => {
    const raw = await requestValue(store.get([ownerId, presetId]));
    if (raw !== undefined) await requestValue(store.delete([ownerId, presetId]));
  });
}

export async function listCoverArtifacts(ownerId: string, options: CoverVaultOptions = {}) {
  requireOwner(ownerId);
  return withStore(ARTIFACT_STORE, 'readonly', options, async (store) => {
    const raw = await requestValue(store.getAll(ownerRange(ownerId)));
    return raw
      .map((item) => SavedCoverArtifactSchema.parse(item))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
}

export async function saveCoverArtifact(
  ownerId: string,
  draftInput: unknown,
  draftRevision: number | null,
  fileName: string,
  pdfBytes: Uint8Array,
  logo?: CoverLogoAsset | null,
  options: CoverVaultOptions = {},
): Promise<SavedCoverArtifact> {
  requireOwner(ownerId);
  const draft: AcademicCoverDraft = AcademicCoverDraftSchema.parse(draftInput);
  if (pdfBytes.byteLength > MAX_PDF_BYTES)
    throw new Error('Cover PDF exceeds the local 4 MB artifact limit.');
  const record = SavedCoverArtifactSchema.parse({
    recordVersion: 1,
    id: id(),
    ownerId,
    createdAt: new Date().toISOString(),
    fileName: z.string().min(1).max(100).parse(fileName),
    templateId: draft.templateId,
    templateVersion: draft.templateVersion,
    pageSize: draft.pageSize,
    draftRevision: z.number().int().positive().nullable().parse(draftRevision),
    draft,
    logo: validateLogo(logo),
    pdfBytes,
  });
  return withStore(ARTIFACT_STORE, 'readwrite', options, async (store) => {
    const raw = await requestValue(store.getAll(ownerRange(ownerId)));
    const records = raw.map((item) => SavedCoverArtifactSchema.parse(item));
    if (records.length >= MAX_ARTIFACTS) {
      const oldest = records.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
      await requestValue(store.delete([ownerId, oldest.id]));
    }
    await requestValue(store.put(record));
    return record;
  });
}

export async function deleteCoverArtifact(
  ownerId: string,
  artifactId: string,
  options: CoverVaultOptions = {},
) {
  requireOwner(ownerId);
  return withStore(ARTIFACT_STORE, 'readwrite', options, async (store) => {
    const raw = await requestValue(store.get([ownerId, artifactId]));
    if (raw !== undefined) await requestValue(store.delete([ownerId, artifactId]));
  });
}

export function presetFromDraft(draftInput: unknown): InstitutionPresetValues {
  const draft = AcademicCoverDraftSchema.parse(draftInput);
  const { templateId, pageSize, content } = draft;
  return InstitutionPresetValuesSchema.parse({
    templateId,
    pageSize,
    institutionName: content.institutionName,
    department: content.department,
    courseCode: content.courseCode,
    courseName: content.courseName,
    instructorName: content.instructorName,
  });
}

export function applyInstitutionPreset(draftInput: unknown, valuesInput: unknown): AcademicCoverDraft {
  const draft = AcademicCoverDraftSchema.parse(draftInput);
  const values = InstitutionPresetValuesSchema.parse(valuesInput);
  const content: AcademicCoverContent = {
    ...draft.content,
    institutionName: values.institutionName,
    department: values.department,
    courseCode: values.courseCode,
    courseName: values.courseName,
    instructorName: values.instructorName,
  };
  return AcademicCoverDraftSchema.parse({
    ...draft,
    templateId: values.templateId,
    pageSize: values.pageSize,
    content,
  });
}
