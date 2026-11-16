// The app server answers GET /n/<anything> with the web app's index.html, exactly as it answers "/",
// and leaves /api, /mcp, /healthz and static assets alone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeNoteId } from '../src/shared/noteAddress.js';
import { makeEnv, userClient, type Env } from './helpers.js';

const INDEX = '<!doctype html><title>Notes</title><div id="root"></div>';
let env: Env;
let web: string;
beforeAll(async () => {
  web = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-web-'));
  fs.writeFileSync(path.join(web, 'index.html'), INDEX);
  fs.mkdirSync(path.join(web, 'assets'));
  fs.writeFileSync(path.join(web, 'assets', 'app-123.js'), 'console.log(1)');
  env = await makeEnv({ NOTES_WEB_DIR: web });
});
afterAll(async () => {
  await env.close();
  fs.rmSync(web, { recursive: true, force: true });
});

const PAGE_HEADERS = ['content-type', 'cache-control', 'content-security-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options'];
const pick = (h: Record<string, unknown>) => Object.fromEntries(PAGE_HEADERS.map((k) => [k, h[k]]));

describe('note addresses on the server', () => {
  it('serves index.html for /n/<id> with the same headers as /', async () => {
    const root = await env.app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.body).toBe(INDEX);
    const id = encodeNoteId('3f2b8c1e-9d4a-4b6e-8f10-2a3b4c5d6e7f');
    for (const url of [`/n/${id}`, '/n/not-a-valid-id', '/n/', `/n/${id}?x=1`]) {
      const r = await env.app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(200);
      expect(r.body, url).toBe(INDEX);
      expect(pick(r.headers), url).toEqual(pick(root.headers));
    }
    expect(pick(root.headers)['cache-control']).toBe('no-cache');
    const head = await env.app.inject({ method: 'HEAD', url: `/n/${id}` });
    expect(head.statusCode).toBe(200);
  });

  it('leaves the API, MCP, health check and assets as they were', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/api/notes' })).statusCode).toBe(401);
    const missing = await env.app.inject({ method: 'GET', url: '/api/n/abc' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toMatch(/json/);
    expect((await env.app.inject({ method: 'GET', url: '/mcp' })).body).not.toBe(INDEX);
    expect((await env.app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true });
    const asset = await env.app.inject({ method: 'GET', url: '/assets/app-123.js' });
    expect(asset.body).toBe('console.log(1)');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    // A POST to a note address is not a page request.
    expect((await env.app.inject({ method: 'POST', url: '/n/abc' })).statusCode).toBe(404);
  });

  it('the API keeps using UUIDs: the base62 form is not a note id there', async () => {
    const alice = await userClient(env, 'alice');
    const n = (await alice.post('/api/notes', { folderId: null })).json();
    expect((await alice.get(`/api/notes/${n.id}`)).statusCode).toBe(200);
    expect((await alice.get(`/api/notes/${encodeNoteId(n.id)}`)).statusCode).toBe(404);
  });
});
