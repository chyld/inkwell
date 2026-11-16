// The Google Fonts stylesheet grammar of FONTS-SPEC 5.1: comments and @font-face blocks only.
// Upstream answers are untrusted: anything outside the grammar fails the fetch.

export class FontFetchError extends Error {}

export interface FaceBlock {
  /** The comment just before the block (e.g. "latin"), or null. */
  slice: string | null;
  family: string;
  style: 'normal' | 'italic';
  /** "400", or "400 700" for a variable range. */
  weight: string;
  weightMin: number;
  weightMax: number;
  url: string;
  unicodeRange: string | null;
}

const fail = (msg: string): never => {
  throw new FontFetchError(msg);
};

const UNICODE_RANGE_RE = /^U\+[0-9A-Fa-f]{1,6}(?:-[0-9A-Fa-f]{1,6})?(?:\s*,\s*U\+[0-9A-Fa-f]{1,6}(?:-[0-9A-Fa-f]{1,6})?)*$/;
const KNOWN = new Set(['font-family', 'font-style', 'font-weight', 'src', 'unicode-range', 'font-stretch', 'font-display']);

/** A font file URL is accepted only as https://fonts.gstatic.com/… on the default port, without user or password. */
export function isAllowedFileUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.hostname === 'fonts.gstatic.com' && u.port === '' && u.username === '' && u.password === '';
}

function unquote(v: string): string {
  const m = /^'([^'\\]*)'$|^"([^"\\]*)"$/.exec(v);
  if (m) return m[1] ?? m[2];
  if (/^[A-Za-z0-9 _-]+$/.test(v)) return v.replace(/\s+/g, ' ');
  return fail('font-family is not a plain name');
}

function parseWeight(v: string): { weight: string; min: number; max: number } {
  const m = /^(\d{1,4})(?:\s+(\d{1,4}))?$/.exec(v);
  if (!m) return fail('font-weight is not one or two integers');
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  if (a < 1 || a > 1000 || b < 1 || b > 1000 || b < a) fail('font-weight is out of range');
  return { weight: m[2] === undefined ? String(a) : `${a} ${b}`, min: a, max: b };
}

function parseSrc(v: string): string {
  const m = /^url\(\s*(?:'([^'"\s()]+)'|"([^'"\s()]+)"|([^'"\s()]+))\s*\)\s+format\(\s*(?:'woff2'|"woff2")\s*\)$/.exec(v);
  if (!m) return fail('src is not exactly one url(…) format(\'woff2\')');
  const url = m[1] ?? m[2] ?? m[3];
  if (!isAllowedFileUrl(url)) fail('a font file URL is not on https://fonts.gstatic.com');
  return url;
}

/** Split a block body into declarations, respecting quotes and parentheses. */
function declarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  let cur = '';
  let quote = '';
  let depth = 0;
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      if (cur.trim()) out.push(split(cur));
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (quote || depth) fail('unbalanced quotes or parentheses');
  if (cur.trim()) out.push(split(cur));
  return out;
}

function split(decl: string): [string, string] {
  const i = decl.indexOf(':');
  if (i < 0) fail('a declaration has no value');
  const name = decl.slice(0, i).trim().toLowerCase();
  const value = decl.slice(i + 1).trim();
  if (!/^[a-z-]+$/.test(name) || !value) fail('a declaration is malformed');
  return [name, value];
}

/**
 * Parse a stylesheet into its @font-face blocks, applying the grammar to every block.
 * `needRange`: unicode-range is required (note faces) or optional (a preview).
 */
export function parseStylesheet(text: string, needRange: boolean): FaceBlock[] {
  const blocks: FaceBlock[] = [];
  let i = 0;
  let pendingComment: string | null = null;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) fail('an unterminated comment');
      pendingComment = text.slice(i + 2, end).trim();
      i = end + 2;
      continue;
    }
    if (/^@font-face\s*\{/i.test(text.slice(i, i + 64))) {
      const open = text.indexOf('{', i);
      const close = text.indexOf('}', open);
      if (close < 0) fail('an unterminated block');
      const body = text.slice(open + 1, close);
      if (body.includes('{')) fail('a nested block');
      blocks.push(block(body, pendingComment, needRange));
      pendingComment = null;
      i = close + 1;
      continue;
    }
    fail('a rule other than @font-face');
  }
  return blocks;
}

function block(body: string, slice: string | null, needRange: boolean): FaceBlock {
  const seen = new Map<string, string>();
  for (const [name, value] of declarations(body)) {
    if (!KNOWN.has(name)) fail(`an unknown descriptor`);
    if (seen.has(name)) fail(`a repeated descriptor`);
    seen.set(name, value);
  }
  for (const req of ['font-family', 'font-style', 'font-weight', 'src', ...(needRange ? ['unicode-range'] : [])]) {
    if (!seen.has(req)) fail(`a missing descriptor`);
  }
  const style = seen.get('font-style')!;
  if (style !== 'normal' && style !== 'italic') fail('font-style is not normal or italic');
  const w = parseWeight(seen.get('font-weight')!);
  const range = seen.get('unicode-range');
  if (range !== undefined && !UNICODE_RANGE_RE.test(range)) fail('unicode-range is malformed');
  return {
    slice,
    family: unquote(seen.get('font-family')!),
    style: style as 'normal' | 'italic',
    weight: w.weight,
    weightMin: w.min,
    weightMax: w.max,
    url: parseSrc(seen.get('src')!),
    unicodeRange: range ?? null,
  };
}
