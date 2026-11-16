// Building the font catalogue snapshot (FONTS-SPEC 4) from Google's public family listing.
// Pure functions: the command in font-catalogue.ts does the reading and writing.
import type { FontCategory, FontEntry } from '../shared/fonts.js';
import { FONT_ID_RE, FONT_ID_MAX } from '../shared/fonts.js';

export class CatalogueError extends Error {}

const CATEGORY: Record<string, FontCategory> = {
  Serif: 'serif',
  'Sans Serif': 'sans-serif',
  Display: 'display',
  Handwriting: 'handwriting',
  Monospace: 'monospace',
};

export interface ListedFamily {
  family: string;
  category: FontCategory;
  subsets: string[];
  /** Keys of `fonts`: "400", "400i", "700", … */
  styles: string[];
}

/** The id rule of 4.1: lower-case, runs outside a-z0-9 become one hyphen, no leading or trailing hyphen. */
export function fontIdOf(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Parse the listing text. Throws CatalogueError, writing nothing, if its shape is not the expected one. */
export function parseListing(text: string): ListedFamily[] {
  let body = text;
  if (body.startsWith(")]}'")) body = body.slice(body.indexOf('\n') + 1);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new CatalogueError('The listing is not JSON.');
  }
  const list = (json as { familyMetadataList?: unknown })?.familyMetadataList;
  if (!Array.isArray(list) || list.length === 0) throw new CatalogueError('The listing has no familyMetadataList array.');
  return list.map((f, i) => {
    const where = `familyMetadataList[${i}]`;
    if (typeof f !== 'object' || f === null) throw new CatalogueError(`${where} is not an object.`);
    const { family, category, subsets, fonts } = f as Record<string, unknown>;
    if (typeof family !== 'string' || !family.trim()) throw new CatalogueError(`${where}.family is not a name.`);
    if (typeof category !== 'string' || !Object.hasOwn(CATEGORY, category)) throw new CatalogueError(`${where} (${family}) has an unknown category ${JSON.stringify(category)}.`);
    if (!Array.isArray(subsets) || !subsets.every((s) => typeof s === 'string')) throw new CatalogueError(`${where} (${family}) has no subsets list.`);
    if (typeof fonts !== 'object' || fonts === null || Array.isArray(fonts)) throw new CatalogueError(`${where} (${family}) has no fonts object.`);
    const styles = Object.keys(fonts);
    for (const k of styles) if (!/^[1-9][0-9]{0,3}i?$/.test(k) || parseInt(k, 10) > 1000) throw new CatalogueError(`${where} (${family}) has an unexpected style key ${JSON.stringify(k)}.`);
    return { family, category: CATEGORY[category], subsets: subsets as string[], styles };
  });
}

type Faces = Pick<FontEntry, 'regular' | 'bold' | 'italic' | 'boldItalic'>;

/** The four face fields of 4.1, or null when the family has no upright style. */
export function facesOf(styles: string[]): Faces | null {
  const upright = styles.filter((s) => !s.endsWith('i')).map(Number);
  const italic = new Set(styles.filter((s) => s.endsWith('i')).map((s) => Number(s.slice(0, -1))));
  if (upright.length === 0) return null;
  // 400 if present, otherwise the nearest to 400, the lower one on a tie.
  const regular = upright.reduce((best, w) => {
    const d = Math.abs(w - 400);
    const bd = Math.abs(best - 400);
    return d < bd || (d === bd && w < best) ? w : best;
  });
  return {
    regular,
    bold: upright.includes(700) && regular !== 700,
    italic: italic.has(regular),
    boldItalic: italic.has(700) && regular !== 700,
  };
}

export interface MergeResult {
  entries: FontEntry[];
  added: string[];
  retired: string[];
  unretired: string[];
}

/**
 * Merge a listing into the existing snapshot under the append-only rule: every id and family is
 * kept; families still listed get their category and face fields updated and are un-retired;
 * families no longer listed (or no longer usable) are retired; new families are added.
 * Throws CatalogueError, naming the families, on an id collision, an empty id or one over 64.
 */
export function mergeCatalogue(existing: FontEntry[], listing: ListedFamily[]): MergeResult {
  const problems: string[] = [];
  const listed = new Map<string, { family: string; category: FontCategory; faces: Faces }>();
  for (const f of listing) {
    if (!f.subsets.includes('latin')) continue;
    const faces = facesOf(f.styles);
    if (!faces) continue;
    const id = fontIdOf(f.family);
    if (!id) problems.push(`"${f.family}" gives an empty id`);
    else if (id.length > FONT_ID_MAX) problems.push(`"${f.family}" gives an id longer than ${FONT_ID_MAX} characters (${id})`);
    else if (!FONT_ID_RE.test(id)) problems.push(`"${f.family}" gives an invalid id (${id})`);
    else if (listed.has(id)) problems.push(`"${listed.get(id)!.family}" and "${f.family}" would share the id ${id}`);
    else listed.set(id, { family: f.family, category: f.category, faces });
  }
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const [id, l] of listed) {
    const old = byId.get(id);
    if (old && old.family !== l.family) problems.push(`"${old.family}" (in the snapshot) and "${l.family}" would share the id ${id}`);
  }
  if (problems.length) throw new CatalogueError(`Not written: ${problems.join('; ')}.`);

  const added: string[] = [];
  const retired: string[] = [];
  const unretired: string[] = [];
  const out: FontEntry[] = [];
  for (const old of existing) {
    const l = listed.get(old.id);
    if (l) {
      if (old.retired) unretired.push(old.family);
      out.push({ id: old.id, family: old.family, category: l.category, ...l.faces, retired: false });
    } else {
      if (!old.retired) retired.push(old.family);
      out.push({ ...old, retired: true });
    }
  }
  for (const [id, l] of listed) {
    if (byId.has(id)) continue;
    added.push(l.family);
    out.push({ id, family: l.family, category: l.category, ...l.faces, retired: false });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { entries: out, added, retired, unretired };
}

/** The snapshot file's text: one entry per line, so changes read well in a diff. */
export function formatCatalogue(entries: FontEntry[]): string {
  return '[\n' + entries.map((e) => JSON.stringify({ id: e.id, family: e.family, category: e.category, regular: e.regular, bold: e.bold, italic: e.italic, boldItalic: e.boldItalic, retired: e.retired })).join(',\n') + '\n]\n';
}
