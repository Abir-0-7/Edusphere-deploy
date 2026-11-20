import Dexie, { type Table } from 'dexie';
import { DraftChecklistSchema, type DraftChecklist } from '@studyvault/types';

type OwnedChecklist = { ownerId: string; id: string; value: DraftChecklist };
class ChecklistCache extends Dexie {
  drafts!: Table<OwnedChecklist, [string, string]>;
  constructor() {
    super('studyvault-draft-checklists-v1');
    this.version(1).stores({ drafts: '[ownerId+id], ownerId' });
  }
}
const cache = new ChecklistCache();
const requireOwner = (ownerId: string) => {
  if (!ownerId.trim()) throw new Error('A signed-in account is required.');
};

export function newChecklist(): DraftChecklist {
  return {
    format: 'studyvault-draft-checklist',
    schema_version: 1,
    id: crypto.randomUUID(),
    revision: 1,
    updated_at: new Date().toISOString(),
    title: 'Draft checklist',
    draft: '',
    criteria: [
      {
        id: crypto.randomUUID(),
        label: 'State the main conclusion',
        status: 'not-reviewed',
        evidence: '',
        note: '',
      },
    ],
  };
}

export async function listChecklists(ownerId: string): Promise<DraftChecklist[]> {
  requireOwner(ownerId);
  const items = await cache.drafts.where('ownerId').equals(ownerId).toArray();
  return items
    .map((row) => DraftChecklistSchema.parse(row.value))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function saveChecklist(
  ownerId: string,
  value: DraftChecklist,
  expectedRevision: number | null,
): Promise<DraftChecklist> {
  requireOwner(ownerId);
  const parsed = DraftChecklistSchema.parse(value);
  return cache.transaction('rw', cache.drafts, async () => {
    const previous = await cache.drafts.get([ownerId, parsed.id]);
    if ((previous?.value.revision ?? null) !== expectedRevision)
      throw new Error('This checklist changed in another tab. Save a separate copy to keep your edits.');
    if (!previous && (await cache.drafts.where('ownerId').equals(ownerId).count()) >= 12)
      throw new Error('This account can save 12 checklists on this device.');
    const next = {
      ...parsed,
      revision: previous ? previous.value.revision + 1 : 1,
      updated_at: new Date().toISOString(),
    };
    await cache.drafts.put({ ownerId, id: next.id, value: next });
    return next;
  });
}

export async function deleteChecklist(ownerId: string, id: string, expectedRevision: number): Promise<void> {
  requireOwner(ownerId);
  await cache.transaction('rw', cache.drafts, async () => {
    const previous = await cache.drafts.get([ownerId, id]);
    if (!previous || previous.value.revision !== expectedRevision)
      throw new Error('This checklist changed. Open its latest revision before removing it.');
    await cache.drafts.delete([ownerId, id]);
  });
}

export function checklistNote(value: DraftChecklist): string {
  const checked = DraftChecklistSchema.parse(value);
  return [
    checked.title,
    'Manual rubric checklist. No automatic grade.',
    ...checked.criteria.map(
      (item) =>
        `${item.label}: ${item.status}\n${item.evidence ? `Draft excerpt: ${item.evidence}\n` : ''}${item.note}`,
    ),
  ].join('\n\n');
}

/** Draft edits invalidate stale evidence rather than preserving an unsupported confirmation. */
export function reviseChecklist(value: DraftChecklist, draft: string): DraftChecklist {
  return {
    ...value,
    draft,
    criteria: value.criteria.map((item) =>
      item.evidence && !draft.includes(item.evidence)
        ? { ...item, evidence: '', status: 'not-reviewed' }
        : item,
    ),
  };
}
