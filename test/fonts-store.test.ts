// The font fetcher and store (FONTS-SPEC 5): what is fetched and refused with nothing stored
// (criterion 10), concurrency and time limits (11), the cap and eviction (13), reconciliation (14),
// data copy and user deletion (18). No network: the upstream fetcher is replaced.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FONT_CATALOGUE, fontById } from '../src/shared/fonts.js';
import { checkFaces } from '../src/server/fonts/upstream.js';
import type { Timers } from '../src/server/fonts/service.js';
import { makeEnv, userClient, type Client, type Env, type EnvExtra } from './helpers.js';
import { FakeUpstream, ManualTimers, SyntheticGoogle, advanceUntil, flush, recorded, until, woff2, type Answer } from './fonts-upstream.js';

let env: Env;
let up: FakeUpstream;
let timers: ManualTimers;
let alice: Client;

async function setup(extra: EnvExtra = {}) {
  up = new FakeUpstream();
  const lazy: Timers = { setTimeout: (fn, ms) => timers.setTimeout(fn, ms), clearTimeout: (h) => timers.clearTimeout(h) };
  env = await makeEnv({}, { fonts: { fetcher: up.fetcher, timers: lazy }, ...extra });
  timers = new ManualTimers(env.clock);
  alice = await userClient(env, 'alice');
}
afterEach(async () => env?.close());

const pool = FONT_CATALOGUE.filter((f) => !f.retired);
const fontRows = () => ({
  files: env.store.db.prepare('SELECT hash, size FROM font_files ORDER BY hash').all(),
  previews: env.store.db.prepare('SELECT font_id, file FROM font_previews ORDER BY font_id').all(),
  units: env.store.db.prepare('SELECT font_id FROM font_face_units ORDER BY font_id').all(),
  faces: env.store.db.prepare('SELECT font_id, seq, file FROM font_faces ORDER BY font_id, seq').all(),
});
const filesOnDisk = () => (fs.existsSync(env.store.fonts.dir) ? fs.readdirSync(env.store.fonts.dir).sort() : []);
const tmpFonts = () => (fs.existsSync(env.store.fonts.tmpDir) ? fs.readdirSync(env.store.fonts.tmpDir).filter((f) => f.startsWith('font-')) : []);
const isEmptyStore = () => {
  const r = fontRows();
  return r.files.length + r.previews.length + r.units.length + r.faces.length === 0 && filesOnDisk().length === 0 && tmpFonts().length === 0;
};
/** Resolve with `a` after `ms` of test time. */
const later = (ms: number, a: Answer): Promise<Answer> => new Promise((r) => timers.setTimeout(() => r(a), ms));

describe('what is fetched, and what is refused with nothing stored (criterion 10)', () => {
  beforeEach(() => setup());

  it('only latin and latin-ext files are requested, once each, with the fixed User-Agent and nothing identifying', async () => {
    const r = await alice.get('/api/fonts/faces/lora');
    expect(r.statusCode, r.body).toBe(200);
    const wanted = new Set(checkFaces(fontById('lora')!, recorded.css('faces-lora')).map((b) => b.url));
    const fileCalls = up.calls.filter((c) => c.url.startsWith('https://fonts.gstatic.com/')).map((c) => c.url);
    expect(new Set(fileCalls)).toEqual(wanted);
    expect(fileCalls.length).toBe(wanted.size); // a file shared by several faces is fetched once
    expect(recorded.css('faces-lora')).toContain('/* cyrillic */'); // offered, never fetched
    for (const c of up.calls) {
      expect(Object.keys(c.headers)).toEqual(['user-agent']);
      expect(c.userAgent).toMatch(/^Mozilla\/5\.0 .*Chrome\/\d+/);
    }
    const faces = r.json().faces;
    expect(faces.length).toBe(8);
    expect(faces[0]).toEqual({ weight: expect.any(String), style: expect.stringMatching(/^(normal|italic)$/), unicodeRange: expect.stringMatching(/^U\+/), file: expect.stringMatching(/^[0-9a-f]{64}$/) });
    // Files are stored under their SHA-256, nothing is left in tmp.
    expect(filesOnDisk()).toEqual([...new Set(faces.map((f: { file: string }) => f.file))].sort());
    expect(tmpFonts()).toEqual([]);
  });

  it('every recorded family is accepted: static, variable, upright-only, regular not 400, 700-only, and a text= preview', async () => {
    for (const id of ['almendra', 'lora', 'abhaya-libre', 'sunflower', 'unifrakturcook', 'titan-one']) expect((await alice.get(`/api/fonts/faces/${id}`)).statusCode, id).toBe(200);
    expect((await alice.get('/api/fonts/preview/titan-one')).json().file).toMatch(/^[0-9a-f]{64}$/);
  });

  const refusals: [string, (url: string) => Answer | undefined][] = [
    ['a redirect', (u) => (u.includes('css2') ? { status: 302, body: null } : undefined)],
    ['a redirect of a file', (u) => (u.includes('gstatic') ? { status: 301, body: null } : undefined)],
    ['a non-200 status', (u) => (u.includes('css2') ? FakeUpstream.status(400) : undefined)],
    ['a non-200 file', (u) => (u.includes('gstatic') ? FakeUpstream.status(404) : undefined)],
    ['a file without the WOFF2 signature', (u) => (u.includes('gstatic') ? FakeUpstream.ok(Buffer.from('OTTO' + 'x'.repeat(100))) : undefined)],
    ['an oversized stylesheet', (u) => (u.includes('css2') ? FakeUpstream.ok('/*' + 'x'.repeat(1024 * 1024) + '*/') : undefined)],
    ['an oversized file', (u) => (u.includes('gstatic') ? FakeUpstream.ok(woff2(2 * 1024 * 1024 + 1)) : undefined)],
    ['a file URL on another host', (u) => (u.includes('css2') ? FakeUpstream.ok(recorded.css('faces-lora').replaceAll('https://fonts.gstatic.com/', 'https://fonts.gstatic.com.evil.example/')) : undefined)],
    ['a font-family that is not the one requested', (u) => (u.includes('css2') ? FakeUpstream.ok(recorded.css('faces-lora').replaceAll("'Lora'", "'Lobster'")) : undefined)],
    ['a network error', () => 'network-error'],
  ];
  for (const [what, route] of refusals) {
    it(`refuses ${what}, storing nothing`, async () => {
      up.route = route;
      const r = await alice.get('/api/fonts/faces/lora');
      expect(r.statusCode).toBe(502);
      expect(r.json().error.code).toBe('font_unavailable');
      expect(isEmptyStore()).toBe(true);
    });
  }

  it('a file at exactly 2 MB and a stylesheet at exactly 1 MB are accepted', async () => {
    const big = woff2(2 * 1024 * 1024);
    up.route = (u) => (u.includes('gstatic') ? FakeUpstream.ok(big) : u.includes('css2') ? FakeUpstream.ok(recorded.css('preview-titan-one').padEnd(1024 * 1024, ' ')) : undefined);
    expect((await alice.get('/api/fonts/preview/titan-one')).statusCode).toBe(200);
  });
});

describe('concurrency and time limits (criterion 11)', () => {
  beforeEach(() => setup());

  it('ten simultaneous requests for one uncached family make one stylesheet request and one per distinct file', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => alice.get('/api/fonts/faces/lora')));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    const distinct = new Set(checkFaces(fontById('lora')!, recorded.css('faces-lora')).map((b) => b.url)).size;
    expect(up.stylesheetCalls()).toBe(1);
    expect(up.fileCalls()).toBe(distinct);
  });

  it('no more than 4 upstream requests run at once', async () => {
    const google = new SyntheticGoogle();
    up.route = (u) => later(500, google.answer(u)!);
    const all = Promise.all(pool.slice(0, 12).map((f) => alice.get(`/api/fonts/faces/${f.id}`)));
    for (let i = 0; i < 40 && up.calls.length < 12 * 4; i++) await timers.advance(500);
    const rs = await all;
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(up.maxRunning).toBe(4);
  });

  it('the 65th waiting operation gets 503, which starts no 60-second window', async () => {
    const google = new SyntheticGoogle();
    let hang = true;
    up.route = (u) => (hang ? 'hang' : google.answer(u));
    const families = pool.slice(0, 4 + 64 + 1);
    const pending = families.slice(0, 68).map((f) => alice.get(`/api/fonts/preview/${f.id}`));
    await until(() => env.app.fontService.waitingOperations === 64, '64 waiting operations');
    expect(up.calls.length).toBe(4); // 4 running, 64 waiting
    const busy = await alice.get(`/api/fonts/preview/${families[68].id}`);
    expect(busy.statusCode).toBe(503);
    expect(busy.json().error.code).toBe('font_busy');
    // Let everything finish: the 4 hung requests time out, the rest succeed.
    hang = false;
    await advanceUntil(timers, env.clock, Promise.all(pending), 20_000);
    const rs = await Promise.all(pending);
    expect(rs.filter((r) => r.statusCode === 200).length).toBe(64);
    expect(rs.filter((r) => r.statusCode === 502).length).toBe(4);
    // No window: the refused family is fetched at once.
    const calls = up.calls.length;
    expect((await alice.get(`/api/fonts/preview/${families[68].id}`)).statusCode).toBe(200);
    expect(up.calls.length).toBeGreaterThan(calls);
  });

  it('the 10-second request limit fails an operation (including reading the body)', async () => {
    up.route = () => 'hang';
    const r = alice.get('/api/fonts/preview/titan-one');
    await timers.advance(9_900);
    let done = false;
    void r.then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    await timers.advance(200);
    expect((await r).statusCode).toBe(502);
    // A body that never finishes counts too.
    await timers.advance(60_000);
    up.route = (u) =>
      u.includes('css2')
        ? {
            status: 200,
            body: {
              async *[Symbol.asyncIterator]() {
                yield Buffer.from('/* latin */');
                await new Promise(() => {});
              },
            },
          }
        : undefined;
    const r2 = alice.get('/api/fonts/preview/lora');
    await timers.advance(10_100);
    expect((await r2).statusCode).toBe(502);
    expect(isEmptyStore()).toBe(true);
  });

  it('the 30-second operation deadline fails an operation, and waiting for a slot does not count toward it', async () => {
    const google = new SyntheticGoogle();
    // One family with 16 files per face set: with 4 slots that is many 9 s waves, well over 30 s.
    google.extraFiles.set('almendra', 2); // 4 faces x (latin, latin-ext, 2 extra) = 16 files
    up.route = (u) => later(9_000, google.answer(u)!);
    const slow = alice.get('/api/fonts/faces/almendra');
    await timers.advance(31_000);
    const r = await slow;
    expect(r.statusCode).toBe(502);
    expect(fontRows().units).toEqual([]);
    expect(tmpFonts()).toEqual([]);

    // Eight blockers whose requests take 9.5 s keep every slot busy; B waits about 19 s for its first
    // slot, then needs 2 x 9 s plus some queueing: well over 30 s in all, under 30 s from its first slot.
    await timers.advance(60_000); // past the failure window
    up.route = (u) => (u.includes('Titan+One') ? later(9_000, google.answer(u)!) : later(9_500, google.answer(u)!));
    const blockers = pool.filter((f) => f.id !== 'titan-one').slice(0, 8).map((f) => alice.get(`/api/fonts/preview/${f.id}`));
    await until(() => env.app.fontService.waitingOperations === 4, '4 blockers running, 4 waiting');
    const start = env.clock.t;
    const b = alice.get('/api/fonts/preview/titan-one');
    await until(() => env.app.fontService.waitingOperations === 5, 'B waiting');
    const { value, at } = await advanceUntil(timers, env.clock, b, 120_000);
    expect(value.statusCode, value.body).toBe(200);
    expect(at - start).toBeGreaterThan(30_000);
    const all = await advanceUntil(timers, env.clock, Promise.all(blockers), 120_000);
    // Blockers whose own operation ran past 30 s from their first slot fail; none hangs.
    expect(all.value.every((x) => x.statusCode === 200 || x.statusCode === 502)).toBe(true);
  });
});

describe('the cap and eviction (criterion 13)', () => {
  // A cap of 10,000 bytes; synthetic families with 1,000-byte files (2 per face: latin, latin-ext).
  beforeEach(() => setup({ storeOptions: { fontCacheBytes: 10_000 } }));
  const google = new SyntheticGoogle();
  const units = () => (fontRows().units as { font_id: string }[]).map((u) => u.font_id);
  // Upright-only, regular-only families: one face, two files, 2,000 bytes each.
  const one = pool.filter((f) => !f.bold && !f.italic && !f.boldItalic);
  const [A, B, C, D, E, P] = one;

  it('removes note faces of unreferenced, non-retired families, least recently used first; keeps previews, collection fonts and retired families', async () => {
    up.route = (u) => google.answer(u);
    const restore = (() => {
      const f = fontById(D.id)! as { retired: boolean };
      f.retired = true;
      return () => (f.retired = false);
    })();
    try {
      // Record retired D first (oldest), then A, B, C, a preview P, an hour apart.
      for (const f of [D, A, B, C]) {
        expect((await alice.get(`/api/fonts/faces/${f.id}`)).statusCode, f.id).toBe(200);
        await timers.advance(2 * 60 * 60_000);
      }
      google.size.set(P.id, 1000);
      expect((await alice.get(`/api/fonts/preview/${P.id}`)).statusCode).toBe(200);
      env.store.fonts.addToCollection(alice.userId, A.id); // A is in a collection
      expect(env.store.fonts.totalBytes()).toBe(9_000);
      // E needs 2,000: B (the least recently used candidate) is evicted, just enough.
      expect((await alice.get(`/api/fonts/faces/${E.id}`)).statusCode).toBe(200);
      expect(units().sort()).toEqual([A.id, C.id, D.id, E.id].sort());
      expect(env.store.fonts.getPreview(P.id)).not.toBeNull();
      expect(env.store.fonts.totalBytes()).toBe(9_000);
      expect(filesOnDisk().length).toBe(9); // 4 face units x 2 files + 1 preview
    } finally {
      restore();
    }
  });

  it('a file shared by two families survives while either remains', async () => {
    up.route = (u) => google.answer(u);
    google.sameFileAs.set(B.id, A.id); // B's stylesheet points at A's files
    await alice.get(`/api/fonts/faces/${A.id}`);
    await timers.advance(2 * 60 * 60_000);
    await alice.get(`/api/fonts/faces/${B.id}`);
    expect(fontRows().files.length).toBe(2); // shared
    await timers.advance(2 * 60 * 60_000);
    google.size.set(C.id, 4000);
    google.size.set(D.id, 3000);
    await alice.get(`/api/fonts/faces/${C.id}`); // 2,000 + 8,000 = 10,000: fits
    expect(units().sort()).toEqual([A.id, B.id, C.id].sort());
    // D needs 6,000: evicting A alone frees nothing (B still uses the files); A and B together free 2,000;
    // C (4,000 x 2) too is needed... C is the newest, so the order is A, B, C.
    google.size.set(D.id, 1000);
    expect((await alice.get(`/api/fonts/faces/${D.id}`)).statusCode).toBe(200); // needs 2,000: A then B go
    expect(units().sort()).toEqual([C.id, D.id].sort());
    expect(fontRows().files.length).toBe(4);
  });

  it('an operation that cannot fit gets 507 and leaves the store unchanged', async () => {
    up.route = (u) => google.answer(u);
    await alice.get(`/api/fonts/faces/${A.id}`);
    env.store.fonts.addToCollection(alice.userId, A.id);
    await alice.get(`/api/fonts/preview/${B.id}`);
    const before = fontRows();
    const disk = filesOnDisk();
    google.size.set(C.id, 4_500); // 9,000 bytes: only A could make room, and A is in a collection
    const r = await alice.get(`/api/fonts/faces/${C.id}`);
    expect(r.statusCode).toBe(507);
    expect(r.json().error).toMatchObject({ code: 'font_store_full', message: 'The font store is full.' });
    expect(fontRows()).toEqual(before);
    expect(filesOnDisk()).toEqual(disk);
    expect(tmpFonts()).toEqual([]);
    // And through adding: the collection is unchanged.
    expect((await alice.put(`/api/fonts/collection/${C.id}`, undefined)).statusCode).toBe(507);
    expect(env.store.fonts.collection(alice.userId)).toEqual([A.id]);
  });
});

describe('reconciliation (criterion 14)', () => {
  beforeEach(() => setup());

  it('with populated tables and an empty fonts directory, start-up clears the rows; fonts are fetched again; collections are intact', async () => {
    expect((await alice.put('/api/fonts/collection/titan-one', undefined)).statusCode).toBe(201);
    await alice.get('/api/fonts/preview/titan-one');
    await alice.get('/api/fonts/faces/lora');
    for (const f of filesOnDisk()) fs.rmSync(path.join(env.store.fonts.dir, f));
    expect(env.store.fonts.reconcile().droppedUnits).toBe(3);
    expect(fontRows()).toEqual({ files: [], previews: [], units: [], faces: [] });
    expect(env.store.fonts.collection(alice.userId)).toEqual(['titan-one']);
    const calls = up.calls.length;
    expect((await alice.get('/api/fonts/preview/titan-one')).statusCode).toBe(200);
    expect((await alice.get('/api/fonts/faces/titan-one')).statusCode).toBe(200);
    expect(up.calls.length).toBeGreaterThan(calls);
  });

  it('files no row refers to are deleted at start-up', async () => {
    fs.mkdirSync(env.store.fonts.dir, { recursive: true });
    fs.writeFileSync(path.join(env.store.fonts.dir, 'a'.repeat(64)), 'stray');
    expect(env.store.fonts.reconcile().deletedFiles).toBe(1);
    expect(filesOnDisk()).toEqual([]);
  });

  it('with one file of a family missing, the whole unit is dropped and fetched again (at start-up and while running)', async () => {
    const faces = (await alice.get('/api/fonts/faces/lora')).json().faces as { file: string }[];
    const files = [...new Set(faces.map((f) => f.file))];
    expect(files.length).toBeGreaterThan(1);
    // While running: the browser asks for the missing file and gets 404; the unit is dropped.
    fs.rmSync(env.store.fonts.filePath(files[0]));
    expect((await alice.get(`/api/fonts/file/${files[0]}`)).statusCode).toBe(404);
    expect(env.store.fonts.getFaces('lora')).toBeNull();
    expect(filesOnDisk()).toEqual([]); // the rest of the unit went too
    const calls = up.calls.length;
    expect((await alice.get('/api/fonts/faces/lora')).statusCode).toBe(200);
    expect(up.calls.length).toBe(calls + 1 + files.length);
    // At start-up.
    fs.rmSync(env.store.fonts.filePath(files[1]));
    expect(env.store.fonts.reconcile().droppedUnits).toBe(1);
    expect(env.store.fonts.getFaces('lora')).toBeNull();
    expect(filesOnDisk()).toEqual([]);
  });
});

describe('data copy and user deletion (criterion 18)', () => {
  beforeEach(() => setup());

  it('notes data copy leaves the font files out and includes the collections; deleting a user removes their collection', async () => {
    expect((await alice.put('/api/fonts/collection/titan-one', undefined)).statusCode).toBe(201);
    expect((await alice.put('/api/fonts/collection/lora', undefined)).statusCode).toBe(201);
    expect(filesOnDisk().length).toBeGreaterThan(0);
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-copy-')), 'copy');
    try {
      await env.store.copy.dataCopy(out);
      expect(fs.existsSync(path.join(out, 'fonts'))).toBe(false);
      const copy = new Database(path.join(out, 'notes.db'), { readonly: true });
      expect(copy.prepare('SELECT font_id FROM font_collection ORDER BY seq').all()).toEqual([{ font_id: 'titan-one' }, { font_id: 'lora' }]);
      copy.close();
    } finally {
      fs.rmSync(path.dirname(out), { recursive: true, force: true });
    }
    const bob = await userClient(env, 'bob');
    expect((await bob.put('/api/fonts/collection/lora', undefined)).statusCode).toBe(201);
    env.store.identity.deleteUser('alice');
    expect(env.store.db.prepare('SELECT user_id, font_id FROM font_collection').all()).toEqual([{ user_id: bob.userId, font_id: 'lora' }]);
    expect(env.store.fonts.getFaces('lora')).not.toBeNull(); // the shared store stays
  });
});
