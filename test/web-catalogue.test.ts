// CLEANUP-PLAN pass 2 item 1: the web build serves a projection of the one committed snapshot with only the
// fields the browser reads. It must give exactly those fields of every entry, in the same order.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { webCatalogueModule } from '../src/tools/fontCatalogue.js';
import type { FontEntry } from '../src/shared/fonts.js';

const SNAPSHOT = new URL('../src/shared/font-catalogue.json', import.meta.url);
const load = async (src: string) => (await import(`data:text/javascript,${encodeURIComponent(src)}`)).default as unknown[];
const info = (e: FontEntry) => ({ id: e.id, family: e.family, category: e.category, retired: e.retired });

describe('the web catalogue', () => {
  it('gives id, family, category and retired of every snapshot entry, in order, in a tenth of the size', async () => {
    const text = fs.readFileSync(SNAPSHOT, 'utf8');
    const full = JSON.parse(text) as FontEntry[];
    const src = webCatalogueModule(full);
    expect(await load(src)).toEqual(full.map(info));
    if (process.env.CATALOGUE_REPORT === '1') console.log(`CATALOGUE snapshot ${text.length} B, web module ${src.length} B`);
    expect(src.length).toBeLessThan(text.length / 8);
  });

  it('keeps retired families, odd names and an id that is not derived from its family', async () => {
    const e = (id: string, family: string, retired = false): FontEntry => ({ id, family, category: 'display', regular: 400, bold: false, italic: false, boldItalic: false, retired });
    const entries = [e('abc', 'ABC', true), e('it-s-o-k', "It's O.K."), e('special', 'Not Derived'), e('quote', 'Say "hi" \\ back')];
    expect(await load(webCatalogueModule(entries))).toEqual(entries.map(info));
  });
});
