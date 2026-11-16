import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { webCatalogueModule } from './src/tools/fontCatalogue.ts';

const SNAPSHOT = path.resolve(import.meta.dirname, 'src/shared/font-catalogue.json');
const WEB_CATALOGUE = '\0web-font-catalogue';

/** FONTS-SPEC 4.1's one snapshot: the browser gets a module made from it with only the fields it reads. */
function webFontCatalogue(): Plugin {
  return {
    name: 'web-font-catalogue',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('font-catalogue.json') || !importer) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      return r?.id === SNAPSHOT ? WEB_CATALOGUE : null;
    },
    load(id) {
      if (id !== WEB_CATALOGUE) return null;
      this.addWatchFile(SNAPSHOT);
      return webCatalogueModule(JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')));
    },
  };
}

export default defineConfig({
  root: 'src/web',
  plugins: [webFontCatalogue(), react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        // The editor screen's code is about 0.5 MB: ProseMirror goes in a chunk of its own, loaded alongside it.
        codeSplitting: { groups: [{ name: 'prosemirror', test: /node_modules[\\/](prosemirror-|orderedmap|rope-sequence|w3c-keyname)/ }] },
      },
    },
    // Fonts are always files under /assets (hashed, cached for a year), never data: URLs (the CSP's font-src is 'self').
    assetsInlineLimit: (file: string) => (file.endsWith('.woff2') ? false : undefined),
  },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
