// A note's address in the browser: /n/<id>, where <id> is the note's UUID written in base62
// (0-9A-Za-z), always 22 characters, left-padded with '0'. A pure, reversible encoding of the
// UUID's 128 bits: nothing new is stored, and the API keeps using UUIDs.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const NOTE_ID_LENGTH = 22; // 62^21 < 2^128 <= 62^22
const MAX = (1n << 128n) - 1n;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[0-9A-Za-z]{22}$/;

/** Base62 form of a UUID. Throws on anything that is not a UUID. */
export function encodeNoteId(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error('not a UUID');
  let n = BigInt('0x' + uuid.replace(/-/g, ''));
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(NOTE_ID_LENGTH, '0');
}

/** The UUID (lowercase, with dashes) for a base62 id, or null if it is not a valid one. */
export function decodeNoteId(id: string): string | null {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  let n = 0n;
  for (const ch of id) n = n * 62n + BigInt(ALPHABET.indexOf(ch));
  if (n > MAX) return null;
  const hex = n.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The address of a note. */
export function notePath(uuid: string): string {
  return `/n/${encodeNoteId(uuid)}`;
}
