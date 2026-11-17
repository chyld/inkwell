// The user's styles: the one list the editor's Styles menu (for the button's name) and the /styles page both show.
// Loaded when an editor mounts, when the menu opens and when /styles opens; refreshed after every create, edit and
// delete. One fetch path: refreshStyles.
import { useSyncExternalStore } from 'react';
import { api, onNewAuthEpoch } from './api';
import type { Style } from './api';

let current: Style[] | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Fetch the list; a failure keeps what is there (or an empty list if nothing was loaded) and is returned. */
export async function refreshStyles(): Promise<unknown> {
  const mine = ++generation;
  try {
    const s = await api<Style[]>('GET', '/styles');
    if (mine === generation) {
      current = Array.isArray(s) ? s : [];
      emit();
    }
    return null;
  } catch (e) {
    if (mine === generation && current === null) {
      current = [];
      emit();
    }
    return e;
  }
}

export function useStyles(): Style[] | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** The list as it stands (null before the first load). */
export const currentStyles = (): Style[] | null => current;

/** Forget the list; a refresh still in flight is ignored when it answers. */
export function resetStyles(): void {
  generation++;
  current = null;
  emit();
}

// The list is one session's: a new session (sign-in, sign-out, a lost session) forgets it (BUGFIX-LIST item 1).
onNewAuthEpoch(resetStyles);
