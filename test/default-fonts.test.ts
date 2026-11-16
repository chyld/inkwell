// The app's own default fonts: Inter for text, JetBrains Mono for code, bundled as static WOFF2 files,
// declared in the stylesheet, served under /assets with long-lived caching; no network needed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fallbackFamily } from '../src/shared/fonts.js';
import { PAGE_CSP } from '../src/server/app.js';
import { makeEnv, type Env } from './helpers.js';

const WEB = path.join(import.meta.dirname, '../src/web');
const css = fs.readFileSync(path.join(WEB, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const faces = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => {
  const d = (k: string) => new RegExp(`${k}: ([^;]+);`).exec(m[1])?.[1];
  return { family: d('font-family'), style: d('font-style'), weight: d('font-weight'), display: d('font-display'), src: d('src'), range: d('unicode-range') };
});

describe('default fonts', () => {
  it('declares Inter and JetBrains Mono: variable weight, upright and italic, Latin and Latin Extended, swap', () => {
    expect(faces.length).toBe(8);
    for (const family of ["'Inter'", "'JetBrains Mono'"]) {
      const mine = faces.filter((f) => f.family === family);
      expect(mine.map((f) => f.style).sort(), family).toEqual(['italic', 'italic', 'normal', 'normal']);
      for (const f of mine) {
        expect(f.weight).toBe(family === "'Inter'" ? '100 900' : '100 800');
        expect(f.display).toBe('swap');
        expect(f.range).toMatch(/^U\+[0-9A-F]{4}/);
        const file = /url\('\.\/(fonts\/default\/[a-z0-9-]+\.woff2)'\) format\('woff2'\)$/.exec(f.src!)![1];
        const bytes = fs.readFileSync(path.join(WEB, file));
        expect(bytes.subarray(0, 4).toString('latin1'), file).toBe('wOF2');
      }
      // Each style once for the latin slice (with Basic Latin) and once for latin-ext.
      expect(mine.filter((f) => f.range!.startsWith('U+0000-00FF')).length).toBe(2);
    }
    // The licence files are kept next to the fonts in the repository (not in the bundle).
    for (const f of ['Inter-OFL.txt', 'JetBrainsMono-OFL.txt']) expect(fs.readFileSync(path.join(WEB, 'fonts/default', f), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('the :root stacks lead with Inter and JetBrains Mono, then the previous system stacks', () => {
    expect(css).toContain("--font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Noto Sans', sans-serif;");
    expect(css).toContain("--font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;");
    expect(/:root \{[^}]*font-family: var\(--font-sans\);/.test(css)).toBe(true);
    expect(/\.prose code \{[^}]*font-family: var\(--font-mono\);/.test(css)).toBe(true);
    // No other font stack anywhere: everything else inherits.
    expect(css.match(/font-family: (?!var\(--font-|'Inter'|'JetBrains Mono')/g)).toBeNull();
  });

  it('only the upright Latin Inter file is preloaded', () => {
    const preloads = [...html.matchAll(/<link rel="preload"[^>]*>/g)].map((m) => m[0]);
    expect(preloads).toEqual(['<link rel="preload" href="./fonts/default/inter-latin-upright.woff2" as="font" type="font/woff2" crossorigin />']);
  });

  it('tabular figures where numbers line up, not in prose', () => {
    const rule = /([^{}]+)\{\s*font-variant-numeric: tabular-nums;\s*\}/.exec(css)!;
    const selectors = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((x) => x.trim());
    expect(selectors).toEqual(['.prose table', '.count', '.note-item time', '.editor-dates', '.storage', '.fonts-count', '.fonts-collection-count']);
    expect(css.match(/tabular-nums/g)!.length).toBe(1);
  });

  it('fonts from /fonts fall back to the app fonts: Inter for sans-serif and display, JetBrains Mono for monospace', () => {
    expect(fallbackFamily('sans-serif')).toBe('"Inter", sans-serif');
    expect(fallbackFamily('display')).toBe('"Inter", sans-serif');
    expect(fallbackFamily('monospace')).toBe('"JetBrains Mono", monospace');
    expect(fallbackFamily('serif')).toBe('serif');
    expect(fallbackFamily('handwriting')).toBe('cursive');
  });

  describe('served like other hashed assets', () => {
    let env: Env;
    let web: string;
    const name = 'inter-latin-upright-Dx4kXJAl.woff2';
    beforeAll(async () => {
      web = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-web-'));
      fs.writeFileSync(path.join(web, 'index.html'), html);
      fs.mkdirSync(path.join(web, 'assets'));
      fs.copyFileSync(path.join(WEB, 'fonts/default/inter-latin-upright.woff2'), path.join(web, 'assets', name));
      env = await makeEnv({ NOTES_WEB_DIR: web });
    });
    afterAll(async () => {
      await env.close();
      fs.rmSync(web, { recursive: true, force: true });
    });

    it('with long-lived caching, the font type, and the unchanged CSP; no session needed, no font store involved', async () => {
      const r = await env.app.inject({ method: 'GET', url: `/assets/${name}` });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('font/woff2');
      expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(r.headers['content-security-policy']).toBe(PAGE_CSP);
      expect(PAGE_CSP).toContain("font-src 'self'");
      expect(r.rawPayload.subarray(0, 4).toString('latin1')).toBe('wOF2');
      expect(env.store.db.prepare('SELECT count(*) AS n FROM font_files').get()).toEqual({ n: 0 });
    });
  });
});
