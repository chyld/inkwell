// Autosave for one open note (SPEC 6.3). Plain TypeScript so it can be tested
// without a browser.
import { ApiError } from './api.js';
import type { DraftStore } from './drafts.js';

export type SaveStatus = 'saved' | 'saving' | 'unsaved';

export interface SaverDeps {
  put(noteId: string, payload: { title: string; body: unknown; version: number }): Promise<{ version: number; updatedAt?: string }>;
  drafts: DraftStore;
  onStatus(status: SaveStatus, message?: string): void;
  onConflict(serverVersion: number): void;
  onSaved?(info: { version: number; updatedAt?: string; title: string; body: unknown }): void;
  onUnauthorized?(): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export const DEBOUNCE_MS = 1000;
export const RETRY_DELAYS_MS = [2000, 5000, 15000];

export class NoteSaver {
  private base: number;
  private latest: { title: string; body: unknown } | null = null;
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

  constructor(
    readonly userId: string,
    readonly noteId: string,
    baseVersion: number,
    private deps: SaverDeps,
  ) {
    this.base = baseVersion;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
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

  /** Record an edit. `immediate` skips the 1 s debounce (used when restoring a draft). */
  change(title: string, body: unknown, immediate = false) {
    if (this.disposed) return;
    this.latest = { title, body };
    this.latestSeq++;
    this.writeDraft();
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

  private writeDraft() {
    if (!this.latest || !this.hasUnconfirmed()) return;
    this.deps.drafts.set(this.userId, this.noteId, { title: this.latest.title, body: this.latest.body, version: this.base, savedAt: Date.now(), owner: this.owner });
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
    const seq = this.latestSeq;
    const snapshot = this.latest;
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
        this.deps.onStatus('unsaved', `Not saved: ${err.message}`);
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
    this.disposed = true;
    if (this.debounce) this.clearTimer(this.debounce);
    if (this.retry) this.clearTimer(this.retry);
    this.debounce = this.retry = null;
    this.notify();
  }
}
