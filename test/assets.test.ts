// BUGFIX-LIST item 2 (server side): a missing /assets/ file (a chunk of an earlier build, asked for by a page loaded
// before a rebuild) is a 404, never index.html, and a miss is never marked immutable. Present assets and the app's
// own addresses are served as before.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeEnv, type Env } from './helpers.js';

let env: Env;
let web: string;
beforeAll(async () => {
  web = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-web-'));
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>Inkwell</title>');
  fs.mkdirSync(path.join(web, 'assets'));
  fs.writeFileSync(path.join(web, 'assets', 'NoteEditor-abc123.js'), 'export {};');
  env = await makeEnv({ NOTES_WEB_DIR: web });
});
afterAll(async () => {
  await env.close();
  fs.rmSync(web, { recursive: true, force: true });
});

describe('/assets', () => {
  it('a present asset: 200, cached for a year', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/assets/NoteEditor-abc123.js' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('a missing asset: 404, not the page, and not cached as immutable', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/assets/NoteEditor-old999.js' });
    expect(r.statusCode).toBe(404);
    expect(r.headers['content-type']).not.toMatch(/text\/html/);
    expect(String(r.headers['cache-control'] ?? '')).not.toMatch(/immutable|max-age=31536000/);
  });

  it('an app address still gets the page', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/n/abc' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
  });
});
