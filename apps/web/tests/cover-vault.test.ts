import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyInstitutionPreset,
  deleteCoverArtifact,
  deleteCoverDraft,
  getCoverDraft,
  listCoverArtifacts,
  listCoverDrafts,
  listInstitutionPresets,
  presetFromDraft,
  saveCoverArtifact,
  saveCoverDraft,
  saveInstitutionPreset,
} from '../src/lib/cover-vault';

vi.mock('@studyvault/types', async () => import('../../../packages/types/src/cover-api'));

const databaseName = 'cover-vault-e03-tests';

async function clearDatabase(): Promise<void> {
  const request = indexedDB.deleteDatabase(databaseName);
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Test database is still open.'));
  });
}

const vaultOptions = { databaseName };

afterEach(clearDatabase);

describe('private cover vault', () => {
  it('stores, isolates and restores versioned drafts and validates their template revision', async () => {
    const draft = {
      templateId: 'project-report',
      pageSize: 'a4',
      content: { title: 'A report', institutionName: 'North U' },
    };
    const saved = await saveCoverDraft('owner:a', draft, null, undefined, vaultOptions);
    expect(saved).toMatchObject({ recordVersion: 1, revision: 1, draft: { templateVersion: 1 } });
    expect(await listCoverDrafts('owner:b', vaultOptions)).toEqual([]);
    expect(await getCoverDraft('owner:b', saved.id, vaultOptions)).toBeNull();

    const next = await saveCoverDraft(
      'owner:a',
      { ...draft, content: { title: 'Updated report' } },
      null,
      saved.id,
      vaultOptions,
    );
    expect(next.revision).toBe(2);
    const restored = await getCoverDraft('owner:a', saved.id, vaultOptions);
    expect(restored?.draft.content.title).toBe('Updated report');
    expect(restored?.draft.templateVersion).toBe(1);
    await expect(saveCoverDraft('', draft, null, undefined, vaultOptions)).rejects.toThrow(/sign in/i);
    await expect(
      saveCoverDraft('owner:a', { ...draft, templateVersion: 2 }, null, undefined, vaultOptions),
    ).rejects.toThrow();
  });

  it('saves versioned institution presets and reapplies values without replacing assignment content', async () => {
    const draft = {
      templateId: 'university-assignment',
      pageSize: 'letter',
      content: { title: 'Lab assignment', assignmentNumber: 'Lab 4', students: [{ name: 'Ada' }] },
    };
    const values = presetFromDraft({
      ...draft,
      content: { ...draft.content, institutionName: 'Example University', courseCode: 'BIO 140' },
    });
    const first = await saveInstitutionPreset('owner:a', 'Biology lab', values, undefined, vaultOptions);
    const second = await saveInstitutionPreset(
      'owner:a',
      'Biology lab',
      { ...values, department: 'Life Sciences' },
      first.id,
      vaultOptions,
    );
    expect(second.revision).toBe(2);
    expect(await listInstitutionPresets('owner:b', vaultOptions)).toEqual([]);
    expect((await listInstitutionPresets('owner:a', vaultOptions))[0]?.name).toBe('Biology lab');
    const applied = applyInstitutionPreset(draft, second.values);
    expect(applied.content).toMatchObject({
      title: 'Lab assignment',
      assignmentNumber: 'Lab 4',
      institutionName: 'Example University',
      courseCode: 'BIO 140',
      department: 'Life Sciences',
    });
    expect(applied.content.students).toEqual([{ name: 'Ada', id: '', section: '' }]);
  });

  it('keeps exact bounded PDF exports, provenance and account isolation', async () => {
    const draft = { templateId: 'minimal-professional', pageSize: 'letter', content: { title: 'Saved PDF' } };
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const artifact = await saveCoverArtifact(
      'owner:a',
      draft,
      2,
      'saved-pdf.pdf',
      pdfBytes,
      null,
      vaultOptions,
    );
    const loaded = await listCoverArtifacts('owner:a', vaultOptions);
    expect(loaded[0]).toMatchObject({
      id: artifact.id,
      recordVersion: 1,
      fileName: 'saved-pdf.pdf',
      templateId: 'minimal-professional',
      templateVersion: 1,
      pageSize: 'letter',
      draftRevision: 2,
    });
    expect(loaded[0]?.pdfBytes).toEqual(pdfBytes);
    expect(await listCoverArtifacts('owner:b', vaultOptions)).toEqual([]);
    await deleteCoverArtifact('owner:b', artifact.id, vaultOptions);
    expect(await listCoverArtifacts('owner:a', vaultOptions)).toHaveLength(1);
    await deleteCoverArtifact('owner:a', artifact.id, vaultOptions);
    expect(await listCoverArtifacts('owner:a', vaultOptions)).toEqual([]);
    await expect(
      saveCoverArtifact(
        'owner:a',
        draft,
        1,
        'x.pdf',
        new Uint8Array(4 * 1024 * 1024 + 1),
        null,
        vaultOptions,
      ),
    ).rejects.toThrow(/4 MB/u);
  });

  it('marks an unsaved PDF artifact as a snapshot instead of inventing a draft revision', async () => {
    const draft = { templateId: 'minimal-professional', pageSize: 'a4', content: { title: 'Unsaved PDF' } };
    const artifact = await saveCoverArtifact(
      'owner:a',
      draft,
      null,
      'unsaved.pdf',
      new Uint8Array([37, 80, 68, 70]),
      null,
      vaultOptions,
    );
    expect(artifact.draftRevision).toBeNull();
  });

  it('deletes only the selected owner draft', async () => {
    const draft = { templateId: 'lab-report', pageSize: 'a4', content: { title: 'Report' } };
    const alice = await saveCoverDraft('alice', draft, null, undefined, vaultOptions);
    const bob = await saveCoverDraft('bob', draft, null, undefined, vaultOptions);
    await deleteCoverDraft('alice', alice.id, vaultOptions);
    expect(await listCoverDrafts('alice', vaultOptions)).toEqual([]);
    expect((await listCoverDrafts('bob', vaultOptions))[0]?.id).toBe(bob.id);
  });
});
