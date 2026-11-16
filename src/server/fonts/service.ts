// Fetching fonts from Google on first need (FONTS-SPEC 5.1). An operation is one preview, or all the
// note faces of one family: one stylesheet request plus one request per distinct file, recorded
// whole or not at all. Every time rule reads the injected clock and timers.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors.js';
import type { FontEntry } from '../../shared/fonts.js';
import { FontFetchError } from './stylesheet.js';
import { FontStoreFull, type DownloadedFile, type FontStore, type StoredFace } from './store.js';
import { checkFaces, checkPreview, facesUrl, httpFetcher, isWoff2, MAX_FILE_BYTES, MAX_STYLESHEET_BYTES, previewUrl, readLimited, USER_AGENT, type Fetcher } from './upstream.js';

export const UPSTREAM_SLOTS = 4;
export const MAX_WAITING_OPERATIONS = 64;
export const REQUEST_TIMEOUT_MS = 10_000;
export const OPERATION_DEADLINE_MS = 30_000;
export const RETRY_AFTER_FAILURE_MS = 60_000;
export const RATE_PER_MINUTE = 1200;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const realTimers: Timers = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

type Kind = 'preview' | 'faces';

export const fontUnavailable = () => new AppError(502, 'font_unavailable', 'This font could not be downloaded. Try again later.');
export const fontBusy = () => new AppError(503, 'font_busy', 'Fonts are busy downloading. Try again in a moment.');
export const fontStoreFull = () => new AppError(507, 'font_store_full', 'The font store is full.');

class Aborted extends Error {}

/** Settle with `p`, or reject as soon as `signal` aborts (even if `p` never settles). */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Aborted('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Aborted('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export class FontService {
  private running = 0;
  private slotWaiters: (() => void)[] = [];
  private waitingOps = 0;
  private ops = new Map<string, Promise<void>>();
  private failures = new Map<string, { until: number; error: AppError }>();
  private calls = new Map<string, number[]>();
  private fetcher: Fetcher;
  private timers: Timers;
  private now: () => number;

  /** Operations started that have not yet had their first upstream slot. */
  get waitingOperations(): number {
    return this.waitingOps;
  }

  constructor(
    private store: FontStore,
    opts: { now: () => number; fetcher?: Fetcher; timers?: Timers },
  ) {
    this.fetcher = opts.fetcher ?? httpFetcher;
    this.timers = opts.timers ?? realTimers;
    this.now = opts.now;
  }

  /** The preview file of a family: from the store, or fetched first. */
  async preview(userId: string, f: FontEntry): Promise<string> {
    const stored = this.store.getPreview(f.id);
    if (stored) {
      this.store.touch('preview', f.id);
      return stored;
    }
    await this.ensure(userId, 'preview', f);
    const file = this.store.getPreview(f.id);
    if (!file) throw fontUnavailable();
    return file;
  }

  /** The note faces of a family: from the store, or fetched first. */
  async faces(userId: string, f: FontEntry): Promise<StoredFace[]> {
    const stored = this.store.getFaces(f.id);
    if (stored) {
      this.store.touch('faces', f.id);
      return stored;
    }
    await this.ensure(userId, 'faces', f);
    const faces = this.store.getFaces(f.id);
    if (!faces) throw fontUnavailable();
    return faces;
  }

  /** Make sure the store has the note faces (adding to a collection). */
  async ensureFaces(userId: string, f: FontEntry): Promise<void> {
    if (this.store.getFaces(f.id)) return;
    await this.ensure(userId, 'faces', f);
    if (!this.store.getFaces(f.id)) throw fontUnavailable();
  }

  /** A request not answered from the store: limited per user, then the failure window, then join or start an operation. */
  private async ensure(userId: string, kind: Kind, f: FontEntry): Promise<void> {
    this.countCall(userId);
    const key = `${kind}:${f.id}`;
    const failed = this.failures.get(key);
    if (failed && failed.until > this.now()) throw failed.error;
    let op = this.ops.get(key);
    if (!op) {
      if (this.waitingOps >= MAX_WAITING_OPERATIONS) throw fontBusy(); // starts no window
      op = this.operation(key, kind, f).finally(() => this.ops.delete(key));
      this.ops.set(key, op);
    }
    await op;
  }

  private countCall(userId: string) {
    const now = this.now();
    const recent = (this.calls.get(userId) ?? []).filter((t) => t > now - 60_000);
    if (recent.length >= RATE_PER_MINUTE) {
      this.calls.set(userId, recent);
      const retryAfter = Math.max(1, Math.ceil((recent[0] + 60_000 - now) / 1000));
      throw new AppError(429, 'font_rate_limited', 'Too many font requests. Try again in a moment.', { retryAfter });
    }
    recent.push(now);
    this.calls.set(userId, recent);
  }

  // ---- upstream slots -----------------------------------------------------------

  private acquireSlot(): Promise<void> {
    if (this.running < UPSTREAM_SLOTS) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.slotWaiters.push(() => {
        this.running++;
          resolve();
      }),
    );
  }

  private releaseSlot() {
    this.running--;
    this.slotWaiters.shift()?.();
  }

  // ---- one operation ----------------------------------------------------------

  private async operation(key: string, kind: Kind, f: FontEntry): Promise<void> {
    const deadline = new AbortController();
    let started = false;
    let deadlineTimer: unknown = null;
    const tmpFiles: string[] = [];
    let queued = false; // counted as a waiting operation: its first request had to wait for a slot

    /** One upstream request in a slot, within 10 s including the body. */
    const request = async (url: string, max: number): Promise<Buffer> => {
      if (!started && this.running >= UPSTREAM_SLOTS) {
        queued = true;
        this.waitingOps++; // decided synchronously, so a burst of new operations is counted exactly
      }
      await this.acquireSlot();
      if (!started) {
        started = true;
        if (queued) {
          queued = false;
          this.waitingOps--;
        }
        deadlineTimer = this.timers.setTimeout(() => deadline.abort(), OPERATION_DEADLINE_MS);
      }
      const ac = new AbortController();
      const onDeadline = () => ac.abort();
      deadline.signal.addEventListener('abort', onDeadline, { once: true });
      const timer = this.timers.setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
      try {
        if (ac.signal.aborted || deadline.signal.aborted) throw new Aborted('aborted');
        const r = await abortable(this.fetcher(url, { headers: { 'user-agent': USER_AGENT }, signal: ac.signal }), ac.signal);
        if (r.status !== 200) throw new FontFetchError(`HTTP ${r.status}`); // includes any redirect
        return await abortable(readLimited(r.body, max), ac.signal);
      } finally {
        this.timers.clearTimeout(timer);
        deadline.signal.removeEventListener('abort', onDeadline);
        this.releaseSlot();
      }
    };

    try {
      if (kind === 'preview') {
        const css = (await request(previewUrl(f), MAX_STYLESHEET_BYTES)).toString('utf8');
        const block = checkPreview(f, css);
        const file = await this.download(block.url, request, tmpFiles);
        this.store.record(f.id, { kind: 'preview', file: file.hash }, [file]);
      } else {
        const css = (await request(facesUrl(f), MAX_STYLESHEET_BYTES)).toString('utf8');
        const blocks = checkFaces(f, css);
        const urls = [...new Set(blocks.map((b) => b.url))]; // only latin and latin-ext files are requested
        // On the first failure the rest are aborted; all settle before the downloads are cleaned up.
        const results = await Promise.allSettled(
          urls.map((u) =>
            this.download(u, request, tmpFiles).catch((e) => {
              deadline.abort();
              throw e;
            }),
          ),
        );
        const failed = results.find((r) => r.status === 'rejected');
        if (failed) throw (failed as PromiseRejectedResult).reason;
        const files = results.map((r) => (r as PromiseFulfilledResult<DownloadedFile>).value);
        const byUrl = new Map(urls.map((u, i) => [u, files[i]]));
        const faces: StoredFace[] = blocks.map((b) => ({ weight: b.weight, style: b.style, unicodeRange: b.unicodeRange!, file: byUrl.get(b.url)!.hash }));
        this.store.record(f.id, { kind: 'faces', faces }, files);
      }
      this.failures.delete(key);
    } catch (e) {
      const error = e instanceof FontStoreFull ? fontStoreFull() : fontUnavailable();
      this.failures.set(key, { until: this.now() + RETRY_AFTER_FAILURE_MS, error });
      throw error;
    } finally {
      if (queued) this.waitingOps--;
      if (deadlineTimer !== null) this.timers.clearTimeout(deadlineTimer);
      for (const t of tmpFiles) fs.rmSync(t, { force: true });
    }
  }

  private async download(url: string, request: (url: string, max: number) => Promise<Buffer>, tmpFiles: string[]): Promise<DownloadedFile> {
    const buf = await request(url, MAX_FILE_BYTES);
    if (!isWoff2(buf)) throw new FontFetchError('not a WOFF2 file');
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    fs.mkdirSync(this.store.tmpDir, { recursive: true });
    const tmpPath = path.join(this.store.tmpDir, `font-${crypto.randomUUID()}`);
    tmpFiles.push(tmpPath);
    fs.writeFileSync(tmpPath, buf);
    return { hash, size: buf.length, tmpPath };
  }
}
