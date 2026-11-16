// npm run fonts:catalogue [-- --from <listing.json>] [-- --out <file>]
// Regenerates src/shared/font-catalogue.json from Google's public family listing (FONTS-SPEC 4.2).
// For developers only: the app and the container never run it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FontEntry } from '../shared/fonts.js';
import { CatalogueError, formatCatalogue, mergeCatalogue, parseListing } from './fontCatalogue.js';

export const LISTING_URL = 'https://fonts.google.com/metadata/fonts';
export const SNAPSHOT = path.resolve(import.meta.dirname, '../shared/font-catalogue.json');

export async function main(argv: string[], log: (s: string) => void = console.log): Promise<number> {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const from = arg('--from');
  const out = arg('--out') ?? SNAPSHOT;
  try {
    let text: string;
    if (from) text = fs.readFileSync(from, 'utf8');
    else {
      // A plain request: no cookies, no identifying headers.
      const r = await fetch(LISTING_URL, { redirect: 'error' });
      if (r.status !== 200) throw new CatalogueError(`The listing answered HTTP ${r.status}.`);
      text = await r.text();
    }
    const listing = parseListing(text);
    const existing: FontEntry[] = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : [];
    const result = mergeCatalogue(existing, listing);
    const tmp = `${out}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, formatCatalogue(result.entries));
    fs.renameSync(tmp, out);
    const active = result.entries.filter((e) => !e.retired).length;
    log(`Wrote ${result.entries.length} families (${active} available, ${result.entries.length - active} retired) to ${out}.`);
    log(`Added ${result.added.length}${result.added.length ? ': ' + result.added.join(', ') : ''}.`);
    log(`Retired ${result.retired.length}${result.retired.length ? ': ' + result.retired.join(', ') : ''}.`);
    log(`Un-retired ${result.unretired.length}${result.unretired.length ? ': ' + result.unretired.join(', ') : ''}.`);
    return 0;
  } catch (e) {
    log(e instanceof CatalogueError ? e.message : `Failed: ${(e as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
