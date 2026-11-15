// Local drafts (SPEC 6.3): kept in localStorage under draft:<user id>:<note id>
// until the server confirms a save. Every localStorage failure is tolerated.
export interface Draft {
  title: string;
  body: unknown;
  version: number;
  savedAt: number;
  /** The editor (tab) that wrote it. */
  owner?: string;
}

export interface DraftStore {
  get(userId: string, noteId: string): Draft | null;
  set(userId: string, noteId: string, d: Draft): void;
  remove(userId: string, noteId: string): void;
  /** Note ids with a draft for this user. */
  list(userId: string): string[];
  removeAllFor(userId: string): void;
  removeAllExcept(userId: string): void;
}

const key = (u: string, n: string) => `draft:${u}:${n}`;

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

export const localDrafts: DraftStore = {
  get(u, n) {
    try {
      const raw = storage()?.getItem(key(u, n));
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (typeof d?.title !== 'string' || typeof d?.version !== 'number') return null;
      return d as Draft;
    } catch {
      return null;
    }
  },
  set(u, n, d) {
    try {
      storage()?.setItem(key(u, n), JSON.stringify(d));
    } catch {
      /* tolerated: quota or disabled storage */
    }
  },
  remove(u, n) {
    try {
      storage()?.removeItem(key(u, n));
    } catch {
      /* tolerated */
    }
  },
  list(u) {
    const prefix = `draft:${u}:`;
    return keys()
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  },
  removeAllFor(u) {
    const prefix = `draft:${u}:`;
    for (const k of keys()) if (k.startsWith(prefix)) this.remove(u, k.slice(prefix.length));
  },
  removeAllExcept(u) {
    const prefix = `draft:${u}:`;
    const s = storage();
    for (const k of keys()) {
      if (!k.startsWith(prefix)) {
        try {
          s?.removeItem(k);
        } catch {
          /* tolerated */
        }
      }
    }
  },
};
