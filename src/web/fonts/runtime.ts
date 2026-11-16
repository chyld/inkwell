// Fonts in the browser (FONTS-SPEC 8.3): faces registered with document.fonts and the rules that
// style marked text. Font files come only from the notes server (/api/fonts/file/<hash>).
import { FONT_HASH_RE, FONT_ID_RE, NOTE_FONTS_MAX, fallbackFamily, fontById } from '../../shared/fonts';

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

/**
 * The fonts of one opening of a note: each id is asked for at most once (whether it succeeds or
 * fails), at most 6 at a time, never more than 50 ids.
 */
export class NoteFontSession {
  private attempted = new Set<string>();
  private queue: string[] = [];
  private active = 0;
  private closed = false;

  constructor(private getFaces: (id: string) => Promise<{ faces: FaceInfo[] }>) {}

  /** The font ids now in the document. */
  update(ids: Iterable<string>) {
    for (const id of ids) {
      if (!fontById(id)) continue;
      ensureFontRule(id);
      if (this.attempted.has(id) || isNoteFontRegistered(id)) continue;
      if (this.attempted.size >= NOTE_FONTS_MAX) continue;
      this.attempted.add(id);
      this.queue.push(id);
    }
    this.pump();
  }

  private pump() {
    while (!this.closed && this.active < NOTE_FONT_CONCURRENCY && this.queue.length) void this.run(this.queue.shift()!);
  }

  private async run(id: string) {
    this.active++;
    try {
      const r = await this.getFaces(id);
      if (!this.closed && !isNoteFontRegistered(id)) registerNoteFont(id, r.faces);
    } catch {
      // The fallback stays, with no message; tried again on the next opening.
    } finally {
      this.active--;
      this.pump();
    }
  }

  close() {
    this.closed = true;
    this.queue = [];
  }
}

// ---- sign-out ----------------------------------------------------------------

const onClear = new Set<() => void>();
export function onFontsCleared(f: () => void) {
  onClear.add(f);
  return () => onClear.delete(f);
}

/** Sign-out: every registered face (previews included) and every rule is removed. */
export function clearAllFonts() {
  for (const id of [...noteFaces.keys()]) dropNoteFont(id);
  rules.clear();
  if (styleEl) styleEl.textContent = '';
  for (const f of onClear) f();
}
