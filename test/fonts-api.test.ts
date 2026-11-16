// /api/fonts (FONTS-SPEC 6) against recorded Google answers: collections (criteria 3, 4), crafted
// ids and hashes (9), headers, auth and limits (15), Google unreachable (12), security (20), and
// "last used" (5.2). No network: the upstream fetcher is replaced.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, ConfigError } from '../src/server/config.js';
import { PAGE_CSP } from '../src/server/app.js';
import { FONT_CATALOGUE, fontById } from '../src/shared/fonts.js';
import type { Timers } from '../src/server/fonts/service.js';
import { makeEnv, userClient, HOST, type Client, type Env } from './helpers.js';
import { FakeUpstream, ManualTimers, SyntheticGoogle, flush, recorded } from './fonts-upstream.js';

let env: Env;
let up: FakeUpstream;
let timers: ManualTimers;
let alice: Client;
let bob: Client;

/** Timers that forward to the manual timers bound to the test clock once the app exists. */
function lazyTimers(): Timers {
  return { setTimeout: (fn, ms) => timers.setTimeout(fn, ms), clearTimeout: (h) => timers.clearTimeout(h) };
}

beforeEach(async () => {
  up = new FakeUpstream();
  env = await makeEnv({}, { fonts: { fetcher: up.fetcher, timers: lazyTimers() } });
  timers = new ManualTimers(env.clock);
  alice = await userClient(env, 'alice');
  bob = await userClient(env, 'bob');
});
afterEach(async () => env.close());

const ids = (r: { json(): unknown }) => r.json() as string[];
/** Mark a catalogue family retired for one test. */
function retire(id: string): () => void {
  const f = fontById(id)!;
  const was = f.retired;
  (f as { retired: boolean }).retired = true;
  return () => ((f as { retired: boolean }).retired = was);
}

describe('collections (criteria 3 and 4)', () => {
  it('adding fetches the note faces once, keeps the order added, survives a reload and is private', async () => {
    const add = await alice.put('/api/fonts/collection/titan-one', undefined);
    expect(add.statusCode, add.body).toBe(201);
    expect(up.stylesheetCalls()).toBe(1);
    expect(up.calls[0].url).toBe(recorded.url('faces-titan-one'));
    const calls = up.calls.length;
    expect((await alice.put('/api/fonts/collection/titan-one', undefined)).statusCode).toBe(200);
    expect(up.calls.length).toBe(calls); // already present: nothing fetched
    expect((await alice.put('/api/fonts/collection/lora', undefined)).statusCode).toBe(201);
    expect(ids(await alice.get('/api/fonts/collection'))).toEqual(['titan-one', 'lora']);
    // Another user sees nothing, and cannot change alice's collection.
    expect(ids(await bob.get('/api/fonts/collection'))).toEqual([]);
    expect((await bob.del('/api/fonts/collection/titan-one')).statusCode).toBe(200);
    expect(ids(await alice.get('/api/fonts/collection'))).toEqual(['titan-one', 'lora']);
    // Remove: 200 whether or not present.
    expect((await alice.del('/api/fonts/collection/titan-one')).statusCode).toBe(200);
    expect((await alice.del('/api/fonts/collection/titan-one')).statusCode).toBe(200);
    expect(ids(await alice.get('/api/fonts/collection'))).toEqual(['lora']);
  });

  it('the 51st add is refused with the stated message and no upstream request; removing one allows an add', async () => {
    const fifty = FONT_CATALOGUE.filter((f) => !f.retired && f.id !== 'titan-one').slice(0, 50);
    for (const f of fifty) expect(env.store.fonts.addToCollection(alice.userId, f.id)).toBe('added');
    const r = await alice.put('/api/fonts/collection/titan-one', undefined);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'collection_full', message: 'You can keep at most 50 fonts. Remove one to add another.' });
    expect(up.calls).toEqual([]);
    // A font already present answers 200, also with 50.
    expect((await alice.put(`/api/fonts/collection/${fifty[3].id}`, undefined)).statusCode).toBe(200);
    expect(up.calls).toEqual([]);
    expect((await alice.del(`/api/fonts/collection/${fifty[0].id}`)).statusCode).toBe(200);
    expect((await alice.put('/api/fonts/collection/titan-one', undefined)).statusCode).toBe(201);
    expect(ids(await alice.get('/api/fonts/collection')).length).toBe(50);
  });

  it('ten parallel adds at 49 leave exactly 50', async () => {
    const google = new SyntheticGoogle();
    up.route = (url) => google.answer(url);
    const pool = FONT_CATALOGUE.filter((f) => !f.retired);
    for (const f of pool.slice(0, 49)) env.store.fonts.addToCollection(alice.userId, f.id);
    const ten = pool.slice(100, 110);
    const rs = await Promise.all(ten.map((f) => alice.put(`/api/fonts/collection/${f.id}`, undefined)));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    expect(rs.filter((r) => r.statusCode === 409).every((r) => r.json().error.code === 'collection_full')).toBe(true);
    expect(ids(await alice.get('/api/fonts/collection')).length).toBe(50);
  });

  it('a failed download leaves the collection unchanged; a present font is never removed by a failed fetch', async () => {
    expect((await alice.put('/api/fonts/collection/titan-one', undefined)).statusCode).toBe(201);
    up.route = () => FakeUpstream.status(500);
    const r = await alice.put('/api/fonts/collection/lora', undefined);
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatchObject({ code: 'font_unavailable', message: 'This font could not be downloaded. Try again later.' });
    expect(ids(await alice.get('/api/fonts/collection'))).toEqual(['titan-one']);
    // Even when the store has lost its faces, adding a present font answers 200 without fetching.
    env.store.db.prepare("DELETE FROM font_face_units WHERE font_id = 'titan-one'").run();
    const before = up.calls.length;
    expect((await alice.put('/api/fonts/collection/titan-one', undefined)).statusCode).toBe(200);
    expect(up.calls.length).toBe(before);
    expect(ids(await alice.get('/api/fonts/collection'))).toEqual(['titan-one']);
  });

  it('a retired family cannot be newly added (409), but one already in a collection stays, answers 200 and can be removed', async () => {
    expect((await alice.put('/api/fonts/collection/titan-one', undefined)).statusCode).toBe(201);
    const restore = retire('titan-one');
    const restore2 = retire('lora');
    try {
      const r = await bob.put('/api/fonts/collection/titan-one', undefined);
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toMatchObject({ code: 'retired', message: 'This font is no longer available from Google Fonts.' });
      expect((await alice.put('/api/fonts/collection/titan-one', undefined)).statusCode).toBe(200);
      expect((await alice.get('/api/fonts/faces/titan-one')).statusCode).toBe(200); // still works from the store
      const calls = up.calls.length;
      expect((await alice.put('/api/fonts/collection/lora', undefined)).statusCode).toBe(409);
      expect(up.calls.length).toBe(calls);
      expect((await alice.del('/api/fonts/collection/titan-one')).statusCode).toBe(200);
      expect(ids(await alice.get('/api/fonts/collection'))).toEqual([]);
    } finally {
      restore();
      restore2();
    }
  });
});

describe('crafted ids and hashes (criterion 9)', () => {
  it('give 404 with no upstream request', async () => {
    const badIds = ['..%2Fx', '%2E%2E%2Fx', 'https%3A%2F%2Fevil.example%2Fx', 'Titan-One', 'TITAN-ONE', 'a'.repeat(65), 'titan%20one', 'titan-one%00', 'no-such-font-family', '-titan-one'];
    for (const id of badIds) {
      for (const [method, url] of [
        ['GET', `/api/fonts/preview/${id}`],
        ['GET', `/api/fonts/faces/${id}`],
        ['PUT', `/api/fonts/collection/${id}`],
        ['DELETE', `/api/fonts/collection/${id}`],
      ] as const) {
        const r = await alice.req(method, url, method === 'PUT' ? undefined : undefined);
        expect(r.statusCode, `${method} ${url}`).toBe(404);
      }
    }
    for (const h of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(64), '..%2F..%2Fnotes.db', `${'a'.repeat(64)}.woff2`]) {
      expect((await alice.get(`/api/fonts/file/${h}`)).statusCode, h).toBe(404);
    }
    expect(up.calls).toEqual([]);
  });
});

describe('headers, sessions and limits (criterion 15)', () => {
  it('GET /file/:hash: 401 without a session; with one, the stated headers and no X-Notes-User needed', async () => {
    const faces = (await alice.get('/api/fonts/faces/titan-one')).json().faces;
    const hash = faces[0].file;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await env.app.inject({ method: 'GET', url: `/api/fonts/file/${hash}` })).statusCode).toBe(401);
    const r = await alice.req('GET', `/api/fonts/file/${hash}`, undefined, { 'x-notes-user': '' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('font/woff2');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(r.rawPayload.subarray(0, 4).toString('latin1')).toBe('wOF2');
  });

  it('every other font route without X-Notes-User is 401; a change with a wrong Origin is 403', async () => {
    for (const [method, url] of [
      ['GET', '/api/fonts/collection'],
      ['PUT', '/api/fonts/collection/titan-one'],
      ['DELETE', '/api/fonts/collection/titan-one'],
      ['GET', '/api/fonts/preview/titan-one'],
      ['GET', '/api/fonts/faces/titan-one'],
    ] as const) {
      expect((await alice.req(method, url, undefined, { 'x-notes-user': '' })).statusCode, `${method} ${url}`).toBe(401);
      expect((await alice.req(method, url, undefined, { 'x-notes-user': bob.userId })).statusCode, `${method} ${url} as bob`).toBe(401);
    }
    for (const method of ['PUT', 'DELETE'] as const) {
      expect((await alice.req(method, '/api/fonts/collection/titan-one', undefined, { origin: 'https://evil.example' })).statusCode).toBe(403);
      expect((await alice.req(method, '/api/fonts/collection/titan-one', undefined, { origin: '' })).statusCode).toBe(403);
    }
    expect(up.calls).toEqual([]);
    expect(ids(await alice.get('/api/fonts/collection'))).toEqual([]);
  });

  it('collection, preview and faces answers are no-store', async () => {
    for (const url of ['/api/fonts/collection', '/api/fonts/preview/titan-one', '/api/fonts/faces/titan-one']) {
      const r = await alice.get(url);
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['cache-control'], url).toBe('private, no-store');
    }
    expect((await alice.put('/api/fonts/collection/titan-one', undefined)).headers['cache-control']).toBe('private, no-store');
  });

  it('the 1,201st uncached request in a minute is 429 with Retry-After; requests answered from the store are not limited', async () => {
    up.route = () => 'network-error';
    for (let i = 0; i < 1200; i++) {
      const r = await alice.get('/api/fonts/preview/titan-one');
      expect(r.statusCode).toBe(502); // the first fails upstream, the rest within the 60 s window: all count
    }
    expect(up.calls.length).toBe(1);
    const limited = await alice.get('/api/fonts/preview/titan-one');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('font_rate_limited');
    expect(limited.headers['retry-after']).toBe('60');
    expect((await alice.put('/api/fonts/collection/lora', undefined)).statusCode).toBe(429); // the same limit for adds
    expect((await bob.get('/api/fonts/preview/titan-one')).statusCode).toBe(502); // per user
    await timers.advance(30_000);
    expect((await alice.get('/api/fonts/preview/titan-one')).headers['retry-after']).toBe('30');
    await timers.advance(30_000);
    up.route = null; // Google is back
    expect((await alice.get('/api/fonts/preview/titan-one')).statusCode).toBe(200);
    // Now stored: not limited at all.
    for (let i = 0; i < 1300; i++) expect((await alice.get('/api/fonts/preview/titan-one')).statusCode).toBe(200);
  });
});

describe('Google unreachable (criterion 12)', () => {
  it('stored fonts still serve; a new font gives the stated message; a repeat within 60 s makes no request; a failed preview does not block faces', async () => {
    expect((await alice.put('/api/fonts/collection/titan-one', undefined)).statusCode).toBe(201);
    const file = (await alice.get('/api/fonts/faces/titan-one')).json().faces[0].file;
    up.route = () => 'network-error';
    expect((await alice.get('/api/fonts/faces/titan-one')).statusCode).toBe(200);
    expect((await alice.get(`/api/fonts/file/${file}`)).statusCode).toBe(200);
    const calls = up.calls.length;
    const r = await alice.put('/api/fonts/collection/lora', undefined);
    expect(r.statusCode).toBe(502);
    expect(r.json().error.message).toBe('This font could not be downloaded. Try again later.');
    expect(up.calls.length).toBe(calls + 1);
    // Within 60 s: the failure answer, no upstream request.
    await timers.advance(59_000);
    expect((await alice.put('/api/fonts/collection/lora', undefined)).statusCode).toBe(502);
    expect((await bob.get('/api/fonts/faces/lora')).statusCode).toBe(502);
    expect(up.calls.length).toBe(calls + 1);
    // A failed preview does not block that family's note faces (and the other way round).
    expect((await alice.get('/api/fonts/preview/almendra')).statusCode).toBe(502);
    expect(up.calls.length).toBe(calls + 2);
    expect((await alice.get('/api/fonts/faces/almendra')).statusCode).toBe(502);
    expect(up.calls.length).toBe(calls + 3);
    // After 60 s the next request tries again.
    await timers.advance(1_000);
    up.route = null;
    expect((await alice.put('/api/fonts/collection/lora', undefined)).statusCode).toBe(201);
  });
});

describe('"last used" (5.2)', () => {
  const lastUsed = (kind: 'preview' | 'faces', fontId: string) =>
    (env.store.db.prepare(`SELECT last_used FROM ${kind === 'preview' ? 'font_previews' : 'font_face_units'} WHERE font_id = ?`).get(fontId) as { last_used: number } | undefined)?.last_used ?? null;
  it('is updated when /faces or /preview serves the family, at most once an hour', async () => {
    await alice.get('/api/fonts/faces/titan-one');
    await alice.get('/api/fonts/preview/titan-one');
    const t0 = lastUsed('faces', 'titan-one');
    expect(lastUsed('preview', 'titan-one')).toBe(t0);
    await timers.advance(30 * 60_000);
    await alice.get('/api/fonts/faces/titan-one');
    expect(lastUsed('faces', 'titan-one')).toBe(t0);
    await timers.advance(31 * 60_000);
    await alice.get('/api/fonts/faces/titan-one');
    await alice.get('/api/fonts/preview/titan-one');
    expect(lastUsed('faces', 'titan-one')).toBe(env.clock.t);
    expect(lastUsed('preview', 'titan-one')).toBe(env.clock.t);
  });
});

describe('security (criterion 20)', () => {
  it('the CSP has its exact present value, on pages, API answers and font files', async () => {
    const EXACT =
      "default-src 'self'; script-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
    expect(PAGE_CSP).toBe(EXACT);
    const faces = await alice.get('/api/fonts/faces/titan-one');
    expect(faces.headers['content-security-policy']).toBe(EXACT);
    const file = await alice.get(`/api/fonts/file/${faces.json().faces[0].file}`);
    expect(file.headers['content-security-policy']).toBe(EXACT);
  });

  it('the app refuses a bad NOTES_FONT_CACHE_MB', () => {
    expect(loadConfig({ NOTES_HOST: HOST }).fontCacheBytes).toBe(500 * 1024 * 1024);
    expect(loadConfig({ NOTES_HOST: HOST, NOTES_FONT_CACHE_MB: '50' }).fontCacheBytes).toBe(50 * 1024 * 1024);
    for (const bad of ['49', '0', '-1', '50.5', 'abc', '1e3x', '500MB']) {
      expect(() => loadConfig({ NOTES_HOST: HOST, NOTES_FONT_CACHE_MB: bad }), bad).toThrow(ConfigError);
      expect(() => loadConfig({ NOTES_HOST: HOST, NOTES_FONT_CACHE_MB: bad }), bad).toThrow(/NOTES_FONT_CACHE_MB=".*" must be a whole number of at least 50/);
    }
  });

  it('logs of font requests contain no family name and no collection contents', async () => {
    await alice.put('/api/fonts/collection/titan-one', undefined);
    await alice.put('/api/fonts/collection/lora', undefined);
    await alice.get('/api/fonts/collection');
    await alice.get('/api/fonts/preview/almendra');
    up.route = () => 'network-error';
    await alice.put('/api/fonts/collection/abhaya-libre', undefined);
    await alice.get('/api/fonts/faces/sunflower');
    await flush();
    const logs = env.logs();
    expect(logs).toContain('/api/fonts/collection/titan-one'); // ids appear in request paths
    for (const name of ['Titan One', 'Titan+One', 'Lora', 'Almendra', 'Abhaya', 'Sunflower', 'fonts.googleapis', 'gstatic']) expect(logs, name).not.toContain(name);
  });
});
