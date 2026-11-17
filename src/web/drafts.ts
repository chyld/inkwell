// Local drafts (SPEC 6.3): kept in localStorage until the server confirms a save. Every localStorage failure is
// tolerated. Each editor (tab) keeps its own draft of a note, under draft:<user id>:<note id>:<owner>, so two tabs
// with unsaved changes to one note both keep them (BUGFIX-LIST-2 item 3); a draft written before owners existed
// is under draft:<user id>:<note id>. A note "has a draft" if it has any; the newest is the one offered.
export interface Draft {
  title: string;
  body: unknown;
  version: number;
  savedAt: number;
  /** The editor (tab) that wrote it. */
  owner?: string;
}

export interface DraftStore {
  /** The newest draft of this note, from any editor but `except` (an editor asking for other tabs' drafts). */
  get(userId: string, noteId: string, except?: string): Draft | null;
  /** Write the draft of its owner (d.owner). */
  set(userId: string, noteId: string, d: Draft): void;
  /** Remove one editor's draft of this note (owner undefined: the draft written before owners existed). */
  removeOne(userId: string, noteId: string, owner: string | undefined): void;
  /** Remove every draft of this note. */
  remove(userId: string, noteId: string): void;
  /** Note ids with a draft for this user (each once). */
  list(userId: string): string[];
  removeAllFor(userId: string): void;
  removeAllExcept(userId: string): void;
}

const key = (u: string, n: string, owner?: string) => (owner ? `draft:${u}:${n}:${owner}` : `draft:${u}:${n}`);

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function keys(): string[] {
  const s = storage();
  const out: string[] = [];
  try {
    if (!s) return out;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith('draft:')) out.push(k);
    }
  } catch {
    /* tolerated */
  }
  return out;
}

function removeKey(k: string) {
  try {
    storage()?.removeItem(k);
  } catch {
    /* tolerated */
  }
}

function read(k: string): Draft | null {
  try {
    const raw = storage()?.getItem(k);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (typeof d?.title !== 'string' || typeof d?.version !== 'number') return null;
    return d as Draft;
  } catch {
    return null;
  }
}

/** The keys of one note's drafts. */
const noteKeys = (u: string, n: string) => keys().filter((k) => k === key(u, n) || k.startsWith(key(u, n) + ':'));

export const localDrafts: DraftStore = {
  get(u, n, except) {
    let best: Draft | null = null;
    for (const k of noteKeys(u, n)) {
      const d = read(k);
      if (d && (except === undefined || d.owner !== except) && (!best || d.savedAt > best.savedAt)) best = d;
    }
    return best;
  },
  set(u, n, d) {
    try {
      storage()?.setItem(key(u, n, d.owner), JSON.stringify(d));
    } catch {
      /* tolerated: quota or disabled storage */
    }
  },
  removeOne(u, n, owner) {
    removeKey(key(u, n, owner));
  },
  remove(u, n) {
    for (const k of noteKeys(u, n)) removeKey(k);
  },
  list(u) {
    const prefix = `draft:${u}:`;
    const ids = keys()
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length).split(':')[0]);
    return [...new Set(ids)];
  },
  removeAllFor(u) {
    const prefix = `draft:${u}:`;
    for (const k of keys()) if (k.startsWith(prefix)) removeKey(k);
  },
  removeAllExcept(u) {
    const prefix = `draft:${u}:`;
    for (const k of keys()) if (!k.startsWith(prefix)) removeKey(k);
  },
};
