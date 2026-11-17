// Empty Trash (SPEC 6.4) and the drafts of the notes it deletes: they are
// mentioned in the confirmation and removed with the notes.
import type { DraftStore } from './drafts';

export interface EmptyTrashDeps {
  userId: string;
  drafts: DraftStore;
  /** Which of these notes (the ones with a draft on this device) are in Trash. Not called when there are none. */
  trashedAmong(ids: string[]): Promise<string[]>;
  confirm(message: string): Promise<boolean>;
  /** DELETE /api/trash. */
  emptyTrash(): Promise<{ deleted: number; deletedIds: string[] }>;
  /** Stop the editors of these (deleted) notes, so that none writes its draft again once it is removed. */
  closeNotes(ids: string[]): void;
}

export async function emptyTrashFlow(d: EmptyTrashDeps): Promise<boolean> {
  // Only the notes with a draft here matter, and usually there are none: then nothing is fetched (before, the
  // whole of Trash was downloaded to find them).
  const drafted = d.drafts.list(d.userId);
  const withDrafts = drafted.length ? (await d.trashedAmong(drafted)).length : 0;
  const ok = await d.confirm(
    'Permanently delete every note in Trash? This cannot be undone.' +
      (withDrafts
        ? ` ${withDrafts === 1 ? 'One of them has' : `${withDrafts} of them have`} changes that exist only on this device; they are discarded too.`
        : ''),
  );
  if (!ok) return false;
  const r = await d.emptyTrash();
  // The editor of a deleted note (open, in a conflict, or still flushing after a switch) is stopped first: closing
  // it afterwards would write its pending changes as a draft again (BUGFIX-LIST-2 item 7).
  d.closeNotes(r.deletedIds);
  for (const id of r.deletedIds) d.drafts.remove(d.userId, id);
  return true;
}
