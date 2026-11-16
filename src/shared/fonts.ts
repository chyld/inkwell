// The font catalogue snapshot (FONTS-SPEC 4.1), shared by the server, the web app and the tests,
// so the editor and the server always agree on which ids exist.
import data from './font-catalogue.json' with { type: 'json' };

export type FontCategory = 'serif' | 'sans-serif' | 'display' | 'handwriting' | 'monospace';
export const FONT_CATEGORIES: readonly FontCategory[] = ['serif', 'sans-serif', 'display', 'handwriting', 'monospace'];

export interface FontEntry {
  id: string;
  family: string;
  category: FontCategory;
  /** The upright weight used as the regular face. */
  regular: number;
  bold: boolean;
  italic: boolean;
  boldItalic: boolean;
  retired: boolean;
}

export const FONT_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const FONT_ID_MAX = 64;
export const FONT_HASH_RE = /^[0-9a-f]{64}$/;
/** A collection holds at most this many fonts, and a note may use at most this many distinct fonts. */
export const COLLECTION_MAX = 50;
export const NOTE_FONTS_MAX = 50;

export const FONT_CATALOGUE: readonly FontEntry[] = data as FontEntry[];
const BY_ID = new Map(FONT_CATALOGUE.map((f) => [f.id, f]));

/** The entry for an id, retired ones included, or undefined. Only ids that match the pattern are looked up. */
export function fontById(id: unknown): FontEntry | undefined {
  if (typeof id !== 'string' || id.length > FONT_ID_MAX || !FONT_ID_RE.test(id)) return undefined;
  return BY_ID.get(id);
}

export function isFontId(id: unknown): id is string {
  return fontById(id) !== undefined;
}

/**
 * What stands in for a font of this category while it loads or if it cannot: the app's own Inter
 * (sans-serif and display) or JetBrains Mono (monospace), then the generic family. Constant strings:
 * they are written into CSS rules.
 */
export function fallbackFamily(category: FontCategory): string {
  switch (category) {
    case 'serif':
      return 'serif';
    case 'monospace':
      return '"JetBrains Mono", monospace';
    case 'handwriting':
      return 'cursive';
    default:
      return '"Inter", sans-serif'; // sans-serif and display
  }
}
