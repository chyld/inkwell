// Fonts in the browser (FONTS-SPEC 8.3): faces registered with document.fonts and the rules that
// style marked text. Font files come only from the notes server (/api/fonts/file/<hash>).
import { FONT_HASH_RE, FONT_ID_RE, NOTE_FONTS_MAX, fallbackFamily, fontById } from '../../shared/fonts';
import { api } from '../api';
import { clearAllFonts, onFontsCleared } from './clearing';

/** What the font code needs from the browser; tests put stand-ins here. */
export interface FontFaceLike {
  readonly loaded: Promise<unknown>;
  load(): Promise<unknown>;
}
export interface FontEnv {
  FontFace: new (family: string, source: string, descriptors: Record<string, string>) => FontFaceLike;
  fonts: { add(face: FontFaceLike): unknown; delete(face: FontFaceLike): unknown };
}

let env: FontEnv | null = null;
/** For tests: the FontFace constructor and the document's font set to use. */
export function setFontEnv(e: FontEnv | null) {
  env = e;
}
export function fontEnv(): FontEnv | null {
  if (env) return env;
  const g = globalThis as unknown as { FontFace?: FontEnv['FontFace']; document?: { fonts?: FontEnv['fonts'] } };
  return g.FontFace && g.document?.fonts ? { FontFace: g.FontFace, fonts: g.document.fonts } : null;
}

export const fileUrl = (hash: string) => `url(/api/fonts/file/${hash})`;

// ---- the rules: one <style> element the app owns ------------------------------------

const rules = new Map<string, string>();
let styleEl: HTMLStyleElement | null = null;

function writeRules() {
  if (typeof document === 'undefined') return;
  if (!styleEl || !styleEl.isConnected) {
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-note-fonts', '');
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = [...rules.values()].join('\n');
}

/** Style text marked with this font. The id reaches CSS only after matching the pattern and the snapshot. */
export function ensureFontRule(id: string) {
  if (rules.has(id) || !FONT_ID_RE.test(id)) return;
  const f = fontById(id);
  if (!f) return;
  rules.set(id, `[data-font="${id}"] { font-family: "nf-${id}", ${fallbackFamily(f.category)}; }`);
  writeRules();
}

/** The text of the rules element (for tests). */
export function fontRulesText(): string {
  return styleEl?.textContent ?? '';
}

// ---- note faces ----------------------------------------------------------------

export interface FaceInfo {
  weight: string;
  style: string;
  unicodeRange: string;
  file: string;
}

/** Faces registered for each font, for the whole session. */
const noteFaces = new Map<string, FontFaceLike[]>();

export function isNoteFontRegistered(id: string) {
  return noteFaces.has(id);
}

/** Remove a font's faces: it shows in the fallback until it is tried again on a later opening. */
function dropNoteFont(id: string) {
  const faces = noteFaces.get(id);
  noteFaces.delete(id);
  const e = fontEnv();
  if (faces && e) for (const f of faces) e.fonts.delete(f);
}

/**
 * Register a font's faces without load(): the browser fetches only the files the text on screen
 * needs, and text is never invisible while a font loads. Throws (registering nothing) on a bad hash
 * or a constructor that throws. A file that later fails to download or decode drops the font.
 */
function registerNoteFont(id: string, faces: FaceInfo[]) {
  const e = fontEnv();
  if (!e) throw new Error('no font support');
  if (!Array.isArray(faces) || faces.length === 0) throw new Error('no faces');
  const made: FontFaceLike[] = [];
  for (const f of faces) {
    if (typeof f?.file !== 'string' || !FONT_HASH_RE.test(f.file)) throw new Error('bad hash');
    made.push(new e.FontFace(`nf-${id}`, fileUrl(f.file), { weight: String(f.weight), style: String(f.style), unicodeRange: String(f.unicodeRange), display: 'swap' }));
  }
  for (const face of made) e.fonts.add(face);
  noteFaces.set(id, made);
  for (const face of made) face.loaded.catch(() => noteFaces.get(id) === made && dropNoteFont(id));
}

export const NOTE_FONT_CONCURRENCY = 6;

export interface FaceLoaderDeps {
  getFaces(id: string): Promise<{ faces: FaceInfo[] }>;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

interface Job {
  id: string;
  owners: Set<object>;
  resolve: (ok: boolean) => void;
}

/**
 * The one app-wide loader of note faces (STYLES-SPEC 10, FONTS-SPEC 8.3): every /faces request of the
 * open note and of every style sample goes through it. At most 6 are in flight in total; requests for
 * the same id are joined; a 429 pauses it until the time given. A queued request that no one wants any
 * more (its note or page was closed) is dropped; one in flight finishes.
 */
export class FaceLoader {
  private queue: Job[] = [];
  private pending = new Map<string, { job: Job; promise: Promise<boolean> }>();
  private active = 0;
  private pausedUntil = 0;
  /** For tests: the most /faces requests seen in flight at once. */
  maxActive = 0;

  constructor(private deps: FaceLoaderDeps) {}

  /** Register a font's faces, asking /faces if needed; resolves true once registered, false on failure. */
  ensure(id: string, owner: object): Promise<boolean> {
    if (isNoteFontRegistered(id)) return Promise.resolve(true);
    const p = this.pending.get(id);
    if (p) {
      p.job.owners.add(owner);
      return p.promise;
    }
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    const job: Job = { id, owners: new Set([owner]), resolve };
    this.pending.set(id, { job, promise });
    void promise.then(() => this.pending.get(id)?.job === job && this.pending.delete(id));
    this.queue.push(job);
    this.pump();
    return promise;
  }

  /** An owner (a note opening, a page, a menu, the form) is gone: queued requests only it wanted are dropped. */
  release(owner: object) {
    this.queue = this.queue.filter((j) => {
      j.owners.delete(owner);
      if (j.owners.size > 0) return true;
      j.resolve(false);
      return false;
    });
  }

  private pump() {
    if (this.deps.now() < this.pausedUntil) return;
    while (this.active < NOTE_FONT_CONCURRENCY && this.queue.length) void this.run(this.queue.shift()!);
  }

  private async run(job: Job) {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    let requeued = false;
    try {
      const r = await this.deps.getFaces(job.id);
      if (!isNoteFontRegistered(job.id)) registerNoteFont(job.id, r.faces);
      job.resolve(true);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 429) {
        // Pause everything until the time given, then ask again.
        const s = Number((e as { extra?: { retryAfter?: unknown } }).extra?.retryAfter);
        const ms = (Number.isFinite(s) && s > 0 ? s : 1) * 1000;
        this.pausedUntil = Math.max(this.pausedUntil, this.deps.now() + ms);
        this.queue.unshift(job);
        requeued = true;
        this.deps.setTimeout(() => this.pump(), ms);
      } else job.resolve(false); // the fallback stays, with no message
    } finally {
      this.active--;
      if (!requeued || this.deps.now() >= this.pausedUntil) this.pump();
    }
  }

  /** Sign-out. */
  reset() {
    for (const j of this.queue) j.resolve(false);
    this.queue = [];
    this.pausedUntil = 0;
  }
}

let loader: FaceLoader | null = null;
export function faceLoader(): FaceLoader {
  if (!loader)
    loader = new FaceLoader({
      getFaces: (id) => api<{ faces: FaceInfo[] }>('GET', `/fonts/faces/${id}`),
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
    });
  return loader;
}
/** For tests: a loader with stand-in dependencies. */
export function setFaceLoader(l: FaceLoader | null) {
  loader = l;
}

/**
 * The fonts of one opening of a note: each id is asked for at most once (whether it succeeds or
 * fails), never more than 50 ids; the requests go through the app-wide loader.
 */
export class NoteFontSession {
  private attempted = new Set<string>();
  private closed = false;

  constructor(private loader: FaceLoader = faceLoader()) {}

  /** The font ids now in the document. */
  update(ids: Iterable<string>) {
    if (this.closed) return;
    for (const id of ids) {
      if (!fontById(id)) continue;
      ensureFontRule(id);
      if (this.attempted.has(id) || isNoteFontRegistered(id)) continue;
      if (this.attempted.size >= NOTE_FONTS_MAX) continue;
      this.attempted.add(id);
      void this.loader.ensure(id, this);
    }
  }

  close() {
    this.closed = true;
    this.loader.release(this);
  }
}

/**
 * The fonts of style samples on one opening of a card page, a menu or the form. They do not count
 * toward any note's limit of 50. An id is asked for once per opening (and again when the form's font
 * changes to it); a failed id is tried again the next time, not before.
 */
export class SampleFontSession {
  private attempted = new Set<string>();
  private closed = false;

  constructor(private loader: FaceLoader = faceLoader()) {}

  want(ids: Iterable<string>) {
    if (this.closed) return;
    for (const id of ids) {
      if (!fontById(id)) continue;
      ensureFontRule(id);
      if (this.attempted.has(id) || isNoteFontRegistered(id)) continue;
      this.attempted.add(id);
      void this.loader.ensure(id, this);
    }
  }

  /** The form's font changed to this id: it may be asked for again. */
  retry(id: string) {
    this.attempted.delete(id);
    this.want([id]);
  }

  close() {
    this.closed = true;
    this.loader.release(this);
  }
}

// ---- sign-out ----------------------------------------------------------------

export { clearAllFonts, onFontsCleared };

// Registered first, when this module loads: this module's faces and rules go before what is built on them.
onFontsCleared(() => {
  for (const id of [...noteFaces.keys()]) dropNoteFont(id);
  rules.clear();
  if (styleEl) styleEl.textContent = '';
  loader?.reset();
});
