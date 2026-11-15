// Sign-out (SPEC 6.3): only a sign-out the server confirmed counts. Drafts are
// discarded only then; if the server cannot be reached the user stays signed
// in, so the session cannot be left alive behind a sign-in page.
import { ApiError } from './api';
import type { DraftStore } from './drafts';

export interface SignOutDeps {
  userId: string;
  drafts: DraftStore;
  /** Ask whether to discard `count` notes' unsaved changes. */
  confirmDiscard(count: number): Promise<boolean>;
  /** DELETE /api/session. */
  deleteSession(): Promise<unknown>;
  disposeSaver(): void;
  notice(message: string): void;
}

/** Returns true if the user is now signed out. */
export async function signOutFlow(d: SignOutDeps): Promise<boolean> {
  const unsaved = d.drafts.list(d.userId);
  if (unsaved.length && !(await d.confirmDiscard(unsaved.length))) return false;
  try {
    await d.deleteSession();
  } catch (e) {
    // 401: the session had already ended, which is what signing out wants.
    if (!(e instanceof ApiError && e.status === 401)) {
      d.notice('You are not signed out: the server could not be reached. Check the connection and try again.');
      return false;
    }
  }
  d.disposeSaver(); // before the drafts go, so a late save cannot write one back
  d.drafts.removeAllFor(d.userId);
  return true;
}
