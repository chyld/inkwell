// FONTS-SPEC 4 and acceptance criterion 19: the snapshot is valid, and the generator, run on a
// recorded listing, applies the append-only, retire and un-retire rules and fails on collisions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_CATALOGUE, FONT_CATEGORIES, FONT_ID_RE, fontById, type FontEntry } from '../src/shared/fonts.js';
import { CatalogueError, facesOf, fontIdOf, formatCatalogue, mergeCatalogue, parseListing } from '../src/tools/fontCatalogue.js';
import { main } from '../src/tools/font-catalogue.js';

const LISTING = fs.readFileSync(new URL('./fixtures/fonts/listing.json', import.meta.url), 'utf8');

describe('the snapshot', () => {
  it('is valid: unique ids matching the pattern, known categories, face fields present and consistent', () => {
    expect(FONT_CATALOGUE.length).toBeGreaterThan(1500);
    const ids = new Set<string>();
    const families = new Set<string>();
    for (const f of FONT_CATALOGUE) {
      expect(Object.keys(f).sort(), f.id).toEqual(['bold', 'boldItalic', 'category', 'family', 'id', 'italic', 'regular', 'retired']);
      expect(f.id, f.family).toMatch(FONT_ID_RE);
      expect(f.id.length).toBeLessThanOrEqual(64);
      expect(ids.has(f.id), f.id).toBe(false);
      expect(families.has(f.family), f.family).toBe(false);
      ids.add(f.id);
      families.add(f.family);
      expect(f.id).toBe(fontIdOf(f.family));
      expect(FONT_CATEGORIES).toContain(f.category);
      expect(Number.isInteger(f.regular) && f.regular >= 1 && f.regular <= 1000, f.id).toBe(true);
      for (const k of ['bold', 'italic', 'boldItalic', 'retired'] as const) expect(typeof f[k], `${f.id}.${k}`).toBe('boolean');
      if (f.regular === 700) expect(f.bold || f.boldItalic, f.id).toBe(false);
    }
    // The file is sorted and in the committed format, so a re-run makes no spurious diff.
    const file = fs.readFileSync(new URL('../src/shared/font-catalogue.json', import.meta.url), 'utf8');
    expect(file).toBe(formatCatalogue([...FONT_CATALOGUE]));
  });

  it('has the families the spec names, with their faces', () => {
    expect(fontById('titan-one')).toMatchObject({ family: 'Titan One', category: 'display', regular: 400, bold: false, italic: false });
    expect(fontById('buda')).toMatchObject({ regular: 300 });
    expect(fontById('molle')).toBeUndefined(); // no upright style
    expect(fontById('Titan-One')).toBeUndefined();
    expect(fontById('../x')).toBeUndefined();
    expect(fontById('a'.repeat(65))).toBeUndefined();
  });
});

describe('the generator, on a recorded listing', () => {
  it('derives ids and face fields as 4.1 says', () => {
    expect(fontIdOf('Titan One')).toBe('titan-one');
    expect(fontIdOf('  M PLUS 1p ')).toBe('m-plus-1p');
    expect(fontIdOf('Ballet & Co.')).toBe('ballet-co');
    expect(facesOf(['300'])).toEqual({ regular: 300, bold: false, italic: false, boldItalic: false });
    expect(facesOf(['300', '500', '700'])).toEqual({ regular: 300, bold: true, italic: false, boldItalic: false }); // tie: the lower
    expect(facesOf(['700', '700i'])).toEqual({ regular: 700, bold: false, italic: true, boldItalic: false });
    expect(facesOf(['400', '400i', '700', '700i'])).toEqual({ regular: 400, bold: true, italic: true, boldItalic: true });
    expect(facesOf(['400i'])).toBeNull();
  });

  it('builds the catalogue: Latin families with an upright style only', () => {
    const r = mergeCatalogue([], parseListing(LISTING));
    const byId = Object.fromEntries(r.entries.map((e) => [e.id, e]));
    expect(byId['allkin']).toBeUndefined(); // no latin subset
    expect(byId['molle']).toBeUndefined(); // no upright style
    expect(byId['buda']).toMatchObject({ regular: 300, bold: false });
    expect(byId['sunflower']).toMatchObject({ regular: 300, bold: true });
    expect(byId['unifrakturcook']).toMatchObject({ regular: 700, bold: false, boldItalic: false });
    expect(byId['lora']).toMatchObject({ category: 'serif', regular: 400, bold: true, italic: true, boldItalic: true });
    expect(byId['courier-prime'].category).toBe('monospace');
    expect(byId['caveat'].category).toBe('handwriting');
    expect(r.entries.every((e) => e.retired === false)).toBe(true);
    expect(r.added.length).toBe(r.entries.length);
    expect(r.entries.map((e) => e.id)).toEqual([...r.entries.map((e) => e.id)].sort());
  });

  it('is append-only: retires families Google dropped, un-retires returning ones, keeps ids and names, updates the rest', () => {
    const listing = parseListing(LISTING);
    const first = mergeCatalogue([], listing).entries;
    // A family that has disappeared, one previously retired that is listed again, and a changed category.
    const gone: FontEntry = { id: 'old-face', family: 'Old Face', category: 'serif', regular: 400, bold: false, italic: false, boldItalic: false, retired: false };
    const before = [...first.map((e) => (e.id === 'lora' ? { ...e, retired: true } : e.id === 'titan-one' ? { ...e, category: 'serif' as const, bold: true } : e)), gone];
    const r = mergeCatalogue(before, listing);
    const byId = Object.fromEntries(r.entries.map((e) => [e.id, e]));
    expect(byId['old-face']).toEqual({ ...gone, retired: true }); // kept, never removed
    expect(byId['lora'].retired).toBe(false);
    expect(byId['titan-one']).toMatchObject({ category: 'display', bold: false });
    expect(r.retired).toEqual(['Old Face']);
    expect(r.unretired).toEqual(['Lora']);
    expect(r.added).toEqual([]);
    // Running again on its own output changes nothing.
    const again = mergeCatalogue(r.entries, listing);
    expect(again.entries).toEqual(r.entries);
    expect(again.added.length + again.unretired.length).toBe(0);
    expect(again.retired).toEqual([]); // already retired: not reported again
  });

  it('fails, naming the families, on an id collision, an empty id or one longer than 64', () => {
    const fam = (family: string) => ({ family, category: 'Serif', subsets: ['latin'], fonts: { '400': {} } });
    const listing = (...families: string[]) => JSON.stringify({ familyMetadataList: families.map(fam) });
    expect(() => mergeCatalogue([], parseListing(listing('Foo Bar', 'Foo-Bar')))).toThrow(/"Foo Bar" and "Foo-Bar" would share the id foo-bar/);
    expect(() => mergeCatalogue([], parseListing(listing('!!!')))).toThrow(/"!!!" gives an empty id/);
    expect(() => mergeCatalogue([], parseListing(listing('X'.repeat(65))))).toThrow(/longer than 64/);
    const existing: FontEntry[] = [{ id: 'foo-bar', family: 'Foo Bar', category: 'serif', regular: 400, bold: false, italic: false, boldItalic: false, retired: true }];
    expect(() => mergeCatalogue(existing, parseListing(listing('Foo.Bar')))).toThrow(/"Foo Bar" \(in the snapshot\) and "Foo.Bar" would share the id foo-bar/);
  });

  it('refuses a listing of an unexpected shape, and tolerates the )]}\' line', () => {
    expect(() => parseListing('not json')).toThrow(CatalogueError);
    expect(() => parseListing('{"families": []}')).toThrow(/familyMetadataList/);
    expect(() => parseListing(JSON.stringify({ familyMetadataList: [{ family: 'A', category: 'Fancy', subsets: ['latin'], fonts: {} }] }))).toThrow(/unknown category/);
    expect(() => parseListing(JSON.stringify({ familyMetadataList: [{ family: 'A', category: 'Serif', subsets: ['latin'], fonts: { regular: {} } }] }))).toThrow(/style key/);
    expect(() => parseListing(JSON.stringify({ familyMetadataList: [{ family: 'A', category: 'Serif', fonts: { '400': {} } }] }))).toThrow(/subsets/);
    expect(parseListing(")]}'\n" + LISTING).length).toBe(parseListing(LISTING).length);
  });

  it('the command merges into the file, reports, and writes nothing when the listing is wrong', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-cat-'));
    try {
      const listingFile = path.join(dir, 'listing.json');
      const out = path.join(dir, 'catalogue.json');
      fs.writeFileSync(listingFile, LISTING);
      const log: string[] = [];
      expect(await main(['--from', listingFile, '--out', out], (s) => log.push(s))).toBe(0);
      const written = fs.readFileSync(out, 'utf8');
      expect(log.join('\n')).toMatch(/Added 13: /);
      expect(log.join('\n')).toMatch(/Retired 0\./);
      fs.writeFileSync(listingFile, JSON.stringify({ nope: true }));
      expect(await main(['--from', listingFile, '--out', out], (s) => log.push(s))).toBe(1);
      expect(fs.readFileSync(out, 'utf8')).toBe(written);
      expect(fs.readdirSync(dir).sort()).toEqual(['catalogue.json', 'listing.json']); // no stray temporary file
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
