// Autosave for one open note (SPEC 6.3). Plain TypeScript so it can be tested
// without a browser.
import { ApiError } from './api.js';
import type { DraftStore } from './drafts.js';

export type SaveStatus = 'saved' | 'saving' | 'unsaved';

export interface SaverDeps {
  put(noteId: string, payload: { title: string; body: unknown; version: number }): Promise<{ version: number; updatedAt?: string }>;
  drafts: DraftStore;
  onStatus(status: SaveStatus, message?: string, error?: ApiError): void;
  onConflict(serverVersion: number): void;
  onSaved?(info: { version: number; updatedAt?: string; title: string; body: unknown }): void;
  onUnauthorized?(): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  /** The clock (tests); default Date.now. */
  now?: () => number;
}

export const DEBOUNCE_MS = 1000;
/** While typing goes on, the draft is never older than this. */
export const DRAFT_EVERY_MS = 2000;
export const RETRY_DELAYS_MS = [2000, 5000, 15000];

export class NoteSaver {
  /** Every saver not yet disposed, including one still flushing after its note was closed. */
  private static live = new Set<NoteSaver>();

  /** Sign-out: stop every saver before the drafts are removed. */
  static disposeAll() {
    for (const s of [...NoteSaver.live]) s.dispose();
  }

  /**
   * Write every live saver's pending draft now. Called when the page is hidden or unloaded, so a tab closed
   * mid-typing still leaves its latest changes on this device (drafts are otherwise written with the save).
   */
  static writeAllDrafts() {
    for (const s of NoteSaver.live) if (s.draftStale) s.writeDraft();
  }

  /** True if any live saver has changes the server has not confirmed. */
  static anyUnconfirmed(): boolean {
    for (const s of NoteSaver.live) if (s.hasUnconfirmed()) return true;
    return false;
  }

  private base: number;
  /** The latest change. `body` may be a function: the editor passes one so the document is serialised only when it is needed. */
  private latest: { title: string; body: unknown } | null = null;
  /** True when the stored draft is older than the latest change. */
  private draftStale = false;
  private draftWrittenAt = 0;
  private takingOver = false;
  private latestSeq = 0;
  private confirmedSeq = 0;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private debounce: unknown = null;
  private retry: unknown = null;
  private retries = 0;
  private blocked: null | 'conflict' | 'fatal' | 'gone' = null;
  private conflictVersion = 0;
  private disposed = false;
  private waiters = new Set<() => boolean>();
  /** Identifies this editor's drafts, so another tab's draft for the same note is never deleted by this one. */
  private readonly owner = Math.random().toString(36).slice(2) + Date.now().toString(36);
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (h: unknown) => void;
  private now: () => number;

  constructor(
    readonly userId: string,
    readonly noteId: string,
    baseVersion: number,
    private deps: SaverDeps,
  ) {
    this.base = baseVersion;
    NoteSaver.live.add(this);
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.now = deps.now ?? Date.now;
  }

  get version() {
    return this.base;
  }

  /** True while there are local changes the server has not confirmed. */
  hasUnconfirmed(): boolean {
    return this.latestSeq !== this.confirmedSeq;
  }

  isConflicted(): boolean {
    return this.blocked === 'conflict';
  }

  /**
   * Record an edit; `body` may be a function returning it. `immediate` skips the 1 s debounce (used when
   * restoring a draft). The draft is written at once for the first change since the last confirmed save (so one
   * exists from the first keystroke), and otherwise when the save is sent, or at once if the page is hidden.
   */
  change(title: string, body: unknown, immediate = false) {
    if (this.disposed) return;
    this.latest = { title, body };
    this.latestSeq++;
    // The draft is written with the first change, and while typing goes on (the save waits for a pause) whenever
    // it is DRAFT_EVERY_MS old, so a tab killed without warning loses at most that much (BUGFIX-LIST item 7).
    if (immediate || this.latestSeq === this.confirmedSeq + 1 || this.now() - this.draftWrittenAt >= DRAFT_EVERY_MS) this.writeDraft();
    else this.draftStale = true;
    if (this.blocked === 'conflict' || this.blocked === 'gone') {
      this.deps.onStatus('unsaved');
      return;
    }
    // A new edit after a non-retryable error (400, 413) gets a fresh attempt.
    this.blocked = null;
    this.deps.onStatus('saving');
    if (this.debounce) this.clearTimer(this.debounce);
    this.debounce = null;
    if (immediate) this.send();
    else this.debounce = this.setTimer(() => {
      this.debounce = null;
      this.send();
    }, DEBOUNCE_MS);
  }

  /** The latest change with its body as a value (calling the editor's function once, if it passed one). */
  private resolved(): { title: string; body: unknown } | null {
    if (this.latest && typeof this.latest.body === 'function') this.latest = { title: this.latest.title, body: (this.latest.body as () => unknown)() };
    return this.latest;
  }

  /** The user restored the stored draft into this editor: it is this editor's now, to replace and to clear. */
  takeOverDraft() {
    this.takingOver = true;
  }

  private writeDraft() {
    this.draftStale = false;
    const latest = this.resolved();
    if (!latest || !this.hasUnconfirmed()) return;
    // Two tabs on one note share one draft: a tab overwrites only a draft it wrote (or took over), so another tab's
    // unsaved work is never replaced and then deleted by this tab's save (BUGFIX-LIST item 8).
    const stored = this.deps.drafts.get(this.userId, this.noteId);
    if (stored && stored.owner !== this.owner && !this.takingOver) {
      this.draftStale = true; // written at the next chance (a keystroke, the send, pagehide) once that one is gone
      return;
    }
    this.takingOver = false;
    this.draftWrittenAt = this.now();
    this.deps.drafts.set(this.userId, this.noteId, { title: latest.title, body: latest.body, version: this.base, savedAt: Date.now(), owner: this.owner });
  }

  /** Remove the stored draft only if this editor wrote it. */
  private clearOwnDraft() {
    const d = this.deps.drafts.get(this.userId, this.noteId);
    if (d && d.owner === this.owner) this.deps.drafts.remove(this.userId, this.noteId);
  }

  private send() {
    if (this.disposed || this.blocked) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    if (!this.hasUnconfirmed() || !this.latest) {
      this.notify();
      return;
    }
    if (this.retry) {
      this.clearTimer(this.retry);
      this.retry = null;
    }
    if (this.draftStale) this.writeDraft(); // the draft is current before the save is attempted
    const seq = this.latestSeq;
    const snapshot = this.resolved()!;
    this.deps.onStatus('saving');
    this.inFlight = this.deps
      .put(this.noteId, { title: snapshot.title, body: snapshot.body, version: this.base })
      .then(
        (res) => {
          // After dispose (sign-out, "load theirs", note closed) nothing more is written or sent.
          if (this.disposed) return;
          this.base = res.version;
          this.confirmedSeq = seq;
          this.retries = 0;
          if (this.latestSeq === seq) {
            this.clearOwnDraft();
            this.deps.onStatus('saved');
          } else {
            this.writeDraft(); // remaining changes are now based on the new version
            this.again = true;
          }
          this.deps.onSaved?.({ version: res.version, updatedAt: res.updatedAt, title: snapshot.title, body: snapshot.body });
        },
        (err) => {
          if (!this.disposed) this.handleError(err);
        },
      )
      .finally(() => {
        this.inFlight = null;
        const again = this.again && !this.blocked && !this.retry && !this.disposed;
        this.again = false;
        if (again) this.send();
        this.notify();
      });
  }

  private handleError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 409 && err.code === 'version_conflict') {
        this.blocked = 'conflict';
        this.conflictVersion = Number(err.extra.version);
        this.deps.onStatus('unsaved', 'This note was changed somewhere else.');
        this.deps.onConflict(this.conflictVersion);
        return;
      }
      if (err.status === 401) {
        this.blocked = 'fatal';
        this.deps.onStatus('unsaved', 'You are signed out. Your changes are kept on this device.');
        this.deps.onUnauthorized?.();
        return;
      }
      if (err.status === 413) {
        this.blocked = 'fatal';
        this.deps.onStatus('unsaved', 'Not saved: your storage limit has been reached. Free some space and edit again to retry.');
        return;
      }
      if (err.status === 400) {
        this.blocked = 'fatal';
        this.deps.onStatus('unsaved', `Not saved: ${err.message}`, err);
        return;
      }
      if (err.status === 404) {
        this.blocked = 'gone';
        this.deps.onStatus('unsaved', 'Not saved: this note no longer exists.');
        return;
      }
      if (err.status === 409) {
        // For example the note is in Trash: not retried automatically, but the next edit
        // tries again, which succeeds once the note has been restored.
        this.blocked = 'fatal';
        this.deps.onStatus('unsaved', `Not saved: ${err.message}`);
        return;
      }
      if (err.status < 500) {
        this.blocked = 'fatal';
        this.deps.onStatus('unsaved', `Not saved: ${err.message}`);
        return;
      }
    }
    // Network error or 5xx: retry after 2, 5, then every 15 seconds.
    const delay = RETRY_DELAYS_MS[Math.min(this.retries, RETRY_DELAYS_MS.length - 1)];
    this.retries++;
    this.deps.onStatus('unsaved', `Not saved: the server could not be reached. Retrying in ${delay / 1000} s.`);
    this.retry = this.setTimer(() => {
      this.retry = null;
      this.send();
    }, delay);
  }

  /** "Keep mine": save again using the version from the 409 response. */
  keepMine() {
    if (this.blocked !== 'conflict') return;
    this.blocked = null;
    this.base = this.conflictVersion;
    this.writeDraft();
    this.send();
  }

  /** "Load theirs": drop the local copy. The caller reloads the note. */
  discardLocal() {
    this.clearOwnDraft();
    this.confirmedSeq = this.latestSeq;
    this.dispose();
  }

  /** Send any pending change now and wait up to `timeoutMs` for it. Resolves true if everything is confirmed. */
  flush(timeoutMs = 3000): Promise<boolean> {
    if (this.draftStale) this.writeDraft();
    if (this.debounce) {
      this.clearTimer(this.debounce);
      this.debounce = null;
      this.send();
    }
    if (!this.hasUnconfirmed()) return Promise.resolve(true);
    if (this.blocked) return Promise.resolve(false);
    return new Promise((resolve) => {
      let t: ReturnType<typeof setTimeout> | undefined;
      const check = () => {
        if (this.inFlight || (this.hasUnconfirmed() && !this.blocked && !this.retry)) return false;
        if (t) clearTimeout(t);
        resolve(!this.hasUnconfirmed());
        return true;
      };
      if (check()) return;
      t = setTimeout(() => {
        this.waiters.delete(check);
        resolve(!this.hasUnconfirmed());
      }, timeoutMs);
      this.waiters.add(check);
    });
  }

  private notify() {
    for (const w of [...this.waiters]) if (w()) this.waiters.delete(w);
  }

  dispose() {
    // Whatever closes the editor (a conflicted note closed by Empty Trash, a switch, sign-out before it removes the
    // drafts) first keeps the pending changes as a draft (BUGFIX-LIST item 9).
    if (!this.disposed && this.draftStale) this.writeDraft();
    this.disposed = true;
    NoteSaver.live.delete(this);
    if (this.debounce) this.clearTimer(this.debounce);
    if (this.retry) this.clearTimer(this.retry);
    this.debounce = this.retry = null;
    this.notify();
  }
}

// A tab hidden or closed mid-typing writes its pending drafts first (pagehide also covers bfcache and mobile).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', () => NoteSaver.writeAllDrafts());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') NoteSaver.writeAllDrafts();
  });
}

/** The saver of the note on screen, for flushing before switching notes or signing out. */
export const activeSaver: { current: NoteSaver | null } = { current: null };
