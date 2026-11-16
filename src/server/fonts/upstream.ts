// Upstream requests to Google Fonts (FONTS-SPEC 5.1). Every URL is built here from a catalogue
// entry; no part of a client request ever reaches one.
import type { FontEntry } from '../../shared/fonts.js';
import { FontFetchError, parseStylesheet, type FaceBlock } from './stylesheet.js';

/** The one fixed modern-browser User-Agent: Google sends WOFF2 with unicode-range slices only to such a client. */
export const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const CSS_BASE = 'https://fonts.googleapis.com/css2';
export const MAX_STYLESHEET_BYTES = 1024 * 1024;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** The family name in a css2 query: URL-encoded with spaces as "+". */
const enc = (family: string) => encodeURIComponent(family).replace(/%20/g, '+');

export function previewUrl(f: FontEntry): string {
  return `${CSS_BASE}?family=${enc(f.family)}:wght@${f.regular}&text=${enc(f.family)}`;
}

export type Face = { italic: boolean; weight: number };

/** The note faces wanted, without duplicates, sorted upright first, then by weight. */
export function wantedFaces(f: FontEntry): Face[] {
  const set = new Map<string, Face>();
  const add = (italic: boolean, weight: number) => set.set(`${italic ? 1 : 0},${weight}`, { italic, weight });
  add(false, f.regular);
  if (f.bold) add(false, 700);
  if (f.italic) add(true, f.regular);
  if (f.boldItalic) add(true, 700);
  return [...set.values()].sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight);
}

export function facesUrl(f: FontEntry): string {
  const faces = wantedFaces(f);
  const spec = faces.some((x) => x.italic)
    ? `ital,wght@${faces.map((x) => `${x.italic ? 1 : 0},${x.weight}`).join(';')}`
    : `wght@${faces.map((x) => x.weight).join(';')}`; // never name an axis the family lacks
  return `${CSS_BASE}?family=${enc(f.family)}:${spec}`;
}

/** The single block of a preview answer. */
export function checkPreview(f: FontEntry, text: string): FaceBlock {
  const blocks = parseStylesheet(text, false);
  if (blocks.length !== 1) throw new FontFetchError('a preview answer must have exactly one block');
  const b = blocks[0];
  if (b.family !== f.family) throw new FontFetchError('the answer is for another family');
  if (b.style !== 'normal' || b.weightMin > f.regular || b.weightMax < f.regular) throw new FontFetchError('the preview face is not the one requested');
  return b;
}

/** The latin and latin-ext blocks of a note-face answer, after the whole answer passed the grammar and checks. */
export function checkFaces(f: FontEntry, text: string): FaceBlock[] {
  const blocks = parseStylesheet(text, true);
  const wanted = wantedFaces(f);
  for (const b of blocks) {
    if (b.family !== f.family) throw new FontFetchError('the answer is for another family');
    const italic = b.style === 'italic';
    if (!wanted.some((w) => w.italic === italic && w.weight >= b.weightMin && w.weight <= b.weightMax)) throw new FontFetchError('the answer has a face that was not requested');
  }
  const kept = blocks.filter((b) => b.slice === 'latin' || b.slice === 'latin-ext');
  if (!kept.some((b) => b.slice === 'latin')) throw new FontFetchError('the answer has no latin block');
  if (!kept.some((b) => b.slice === 'latin' && b.style === 'normal' && b.weightMin <= f.regular && b.weightMax >= f.regular)) throw new FontFetchError('the answer lacks the upright regular face');
  return kept;
}

// ---- the replaceable fetcher -----------------------------------------------

export interface UpstreamResponse {
  status: number;
  body: AsyncIterable<Uint8Array> | null;
}
export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<UpstreamResponse>;

/** The real fetcher: no redirects followed, no cookies, only the headers given. */
export const httpFetcher: Fetcher = async (url, init) => {
  const r = await fetch(url, { headers: init.headers, signal: init.signal, redirect: 'manual', credentials: 'omit' });
  return { status: r.status, body: r.body as unknown as AsyncIterable<Uint8Array> | null };
};

/** Read a body, failing as soon as it exceeds `max` bytes. */
export async function readLimited(body: AsyncIterable<Uint8Array> | null, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  if (body) {
    for await (const c of body) {
      total += c.length;
      if (total > max) throw new FontFetchError('the answer is too large');
      chunks.push(Buffer.from(c));
    }
  }
  return Buffer.concat(chunks, total);
}

export function isWoff2(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === 'wOF2';
}
