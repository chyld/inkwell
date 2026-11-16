// The note rules that need no editor: limits, allowed links and image addresses, colour names, text sizes,
// tags and the font scan. Imported by the web app's menus and pages without pulling in Tiptap; schema.ts
// (the schema itself and the validator) re-exports all of it.
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

export const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
export const MAX_TITLE_CHARS = 200;

const IMAGE_SRC_RE = /^\/api\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

/** Image id from an allowed `src`, or null. */
export function imageIdFromSrc(src: unknown): string | null {
  if (typeof src !== 'string') return null;
  const m = IMAGE_SRC_RE.exec(src);
  return m ? m[1] : null;
}

export function imageSrc(id: string): string {
  return `/api/images/${id}`;
}

/** True for absolute http, https and mailto URLs only. */
export function isAllowedHref(href: unknown): boolean {
  if (typeof href !== 'string' || href.length === 0 || href.length > 2048) return false;
  // Reject control characters and whitespace that browsers strip before parsing a scheme.
  if (/[\u0000- \u007f]/.test(href)) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (!ALLOWED_SCHEMES.includes(url.protocol)) return false;
  // The scheme must be written literally at the start (no tricks like "java\tscript:").
  return href.toLowerCase().startsWith(url.protocol);
}

/** A pasted `width`/`height` attribute: a whole number of pixels the validator accepts, otherwise none. */
export function parseImageDimension(v: string | null): number | null {
  if (v === null || !/^\s*\d{1,6}\s*$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n <= 100000 ? n : null;
}

// ---- text colour and highlight ------------------------------------------
// A note stores a colour's NAME only; the stylesheet maps each name to a light- and a dark-theme
// value. Rendered as a data attribute, never an inline style. Pasted HTML gets a mark only when
// it carries our own attribute with one of these names. Inline code excludes every other mark and
// code blocks allow none, so colours never apply inside code.
export const TEXT_COLORS = ['ruby', 'garnet', 'amber', 'emerald', 'teal', 'sapphire', 'amethyst', 'onyx'] as const;
export const HIGHLIGHT_COLORS = ['topaz', 'coral', 'ruby', 'amethyst', 'sapphire', 'aqua', 'emerald', 'peridot'] as const;

// ---- text size ---------------------------------------------------------------
// One attribute, `size`: a whole number of pixels from 8 to 96. Rendered as <span data-font-size="18">:
// no inline style; the stylesheet has a rule for each value. Never inside code.
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 96;
/** Body text in a note, and the default size of each heading level (the stylesheet matches these). */
export const TEXT_SIZE_DEFAULT = 16;
export const HEADING_SIZES: Record<number, number> = { 1: 26, 2: 21, 3: 18 };

export function isFontSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= FONT_SIZE_MIN && v <= FONT_SIZE_MAX;
}

/** The size text has in a block when it carries no size mark. */
export function defaultSizeOf(block: { type: { name: string }; attrs: Record<string, unknown> }): number {
  return block.type.name === 'heading' ? (HEADING_SIZES[block.attrs.level as number] ?? TEXT_SIZE_DEFAULT) : TEXT_SIZE_DEFAULT;
}

/** The distinct font ids used in a document (JSON or ProseMirror node). */
export function fontsInDoc(doc: PMNode): Set<string> {
  const out = new Set<string>();
  doc.descendants((n) => {
    for (const m of n.marks) if (m.type.name === 'fontFamily' && typeof m.attrs.font === 'string') out.add(m.attrs.font);
  });
  return out;
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

const encoder = new TextEncoder();
export function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

/** Character count in Unicode code points. */
export function charLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export const TAG_MAX_CHARS = 50;
export const TAGS_PER_NOTE = 20;

/** Normalise a tag (SPEC 7.2). Returns null if it breaks a rule. */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (t.length === 0 || charLength(t) > TAG_MAX_CHARS || t.includes(',')) return null;
  if (/[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}
