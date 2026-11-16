// The user's styles, shared by the editor's Styles menu (for the button's name) and the /styles page. Loaded
// when an editor mounts and when the menu opens; refreshed after every create, edit and delete.
import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { Style } from './components/StyleForm';

let current: Style[] | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setStyles(list: Style[]): void {
  generation++;
  current = list;
  emit();
}

/** Fetch the list; a failure keeps what is there (or an empty list if nothing was loaded). */
export async function refreshStyles(): Promise<void> {
  const mine = ++generation;
  try {
    const s = await api<Style[]>('GET', '/styles');
    if (mine === generation) {
      current = Array.isArray(s) ? s : [];
      emit();
    }
  } catch {
    if (mine === generation && current === null) {
      current = [];
      emit();
    }
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

/** For tests: forget the list. */
export function resetStyles(): void {
  generation++;
  current = null;
  emit();
}
