// The whole catalogue entries, with the face fields that only the server's requests to Google read
// (FONTS-SPEC 4.1). The web bundle carries just the FontInfo fields of the same snapshot.
import data from '../../shared/font-catalogue.json' with { type: 'json' };
import { fontById, type FontEntry } from '../../shared/fonts.js';

export const FONT_ENTRIES: readonly FontEntry[] = data as FontEntry[];
const BY_ID = new Map(FONT_ENTRIES.map((f) => [f.id, f]));

/** The whole entry for an id (retired ones included), or undefined; the same lookup rules as fontById. */
export function fontEntryById(id: unknown): FontEntry | undefined {
  const f = fontById(id);
  return f && BY_ID.get(f.id);
}
