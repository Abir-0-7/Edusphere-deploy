import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DraftChecklistSchema } from '@studyvault/types';
import {
  checklistNote,
  listChecklists,
  newChecklist,
  reviseChecklist,
  saveChecklist,
} from '../src/lib/draft-checklist';

describe('manual draft checklist', () => {
  it('requires exact current evidence and invalidates stale confirmations after edits', () => {
    const initial = newChecklist();
    const value = {
      ...initial,
      draft: 'The experiment observed a queue.',
      criteria: [{ ...initial.criteria[0]!, status: 'supported' as const, evidence: 'observed a queue' }],
    };
    expect(DraftChecklistSchema.parse(value)).toEqual(value);
    expect(DraftChecklistSchema.safeParse({ ...value, draft: 'Unrelated revised draft' }).success).toBe(
      false,
    );
    const revised = reviseChecklist(value, 'A revised conclusion');
    expect(revised.criteria[0]).toMatchObject({ evidence: '', status: 'not-reviewed' });
    expect(DraftChecklistSchema.parse(revised)).toEqual(revised);
    expect(checklistNote(value)).toContain('No automatic grade');
    expect(checklistNote(value)).toContain('Draft excerpt: observed a queue');
  });

  it('isolates accounts and compares revisions atomically under competing saves', async () => {
    const owner = crypto.randomUUID();
    const initial = newChecklist();
    const saved = await saveChecklist(owner, initial, null);
    expect(await listChecklists(owner + '-other')).toEqual([]);
    const attempts = await Promise.allSettled([
      saveChecklist(owner, { ...saved, title: 'First tab' }, 1),
      saveChecklist(owner, { ...saved, title: 'Second tab' }, 1),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await listChecklists(owner))[0]?.revision).toBe(2);
    expect(await listChecklists(owner + '-other')).toEqual([]);
  });

  it('enforces the bounded device retention and schema', async () => {
    const owner = crypto.randomUUID();
    for (let index = 0; index < 12; index++) await saveChecklist(owner, newChecklist(), null);
    await expect(saveChecklist(owner, newChecklist(), null)).rejects.toThrow('12 checklists');
    expect(DraftChecklistSchema.safeParse({ ...newChecklist(), draft: 'a'.repeat(10_001) }).success).toBe(
      false,
    );
    await expect(listChecklists('')).rejects.toThrow('signed-in');
  });
});
