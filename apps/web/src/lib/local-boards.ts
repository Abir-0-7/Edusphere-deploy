/** Account-scoped manual snapshots and tldraw IndexedDB/broadcast keys.
 * Legacy shared keys intentionally remain unread: they have no trusted owner.
 */
export function boardStorageKeys(ownerId: string): { snapshot: string; persistence: string } {
  if (!ownerId.trim()) throw new Error('A signed-in account is required for local boards');
  const account = encodeURIComponent(ownerId);
  return {
    snapshot: `studyvault:whiteboard:v2:${account}`,
    persistence: `studyvault-whiteboard:v2:${account}`,
  };
}

export function saveLocalBoard(ownerId: string, snapshot: string, storage: Storage = localStorage): void {
  storage.setItem(boardStorageKeys(ownerId).snapshot, snapshot);
}

export function loadLocalBoard(ownerId: string, storage: Storage = localStorage): string | null {
  return storage.getItem(boardStorageKeys(ownerId).snapshot);
}

export function clearLocalBoard(ownerId: string, storage: Storage = localStorage): void {
  storage.removeItem(boardStorageKeys(ownerId).snapshot);
}
