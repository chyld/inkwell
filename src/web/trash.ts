// Empty Trash (SPEC 6.4) and the drafts of the notes it deletes: they are
// mentioned in the confirmation and removed with the notes.
import type { DraftStore } from './drafts';

export interface EmptyTrashDeps {
  userId: string;
  drafts: DraftStore;
  /** Ids of every note in Trash. */
  trashedIds(): Promise<string[]>;
  confirm(message: string): Promise<boolean>;
  /** DELETE /api/trash. */
  emptyTrash(): Promise<{ deleted: number; deletedIds: string[] }>;
}

export async function emptyTrashFlow(d: EmptyTrashDeps): Promise<boolean> {
  const inTrash = new Set(await d.trashedIds());
  const withDrafts = d.drafts.list(d.userId).filter((id) => inTrash.has(id)).length;
  const ok = await d.confirm(
    'Permanently delete every note in Trash? This cannot be undone.' +
      (withDrafts
        ? ` ${withDrafts === 1 ? 'One of them has' : `${withDrafts} of them have`} changes that exist only on this device; they are discarded too.`
        : ''),
  );
  if (!ok) return false;
  const r = await d.emptyTrash();
  for (const id of r.deletedIds) d.drafts.remove(d.userId, id);
  return true;
}
