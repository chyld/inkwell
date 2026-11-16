// Measured SQL work per request (CLEANUP-PLAN pass 1, items 1 and 2). Counts come from better-sqlite3's verbose
// hook (statements executed) and a wrapper on prepare (statements compiled), so they include the session check.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, doc, makeEnv, p, upload, userClient, type Env } from './helpers.js';
import sharp from 'sharp';

let env: Env;
let c: Client;
beforeEach(async () => {
  env = await makeEnv();
  c = await userClient(env, 'alice');
});
afterEach(async () => {
  await env.close();
});

/** Run one request (after a warm-up of the same kind) and return what it cost. */
async function measure(run: () => Promise<{ statusCode: number }>, warm?: () => Promise<unknown>) {
  if (warm) await warm();
  env.sql.reset();
  const r = await run();
  return { status: r.statusCode, executed: env.sql.executed.length, compiled: env.sql.compiled.length, sql: env.sql.executed };
}

const REPORT = process.env.SQL_REPORT === '1';
const report = (name: string, m: { executed: number; compiled: number; sql: string[] }) => {
  if (REPORT) console.log(`SQL ${name}: executed ${m.executed}, compiled ${m.compiled}\n  ${m.sql.join('\n  ')}`);
};

describe('SQL work per request', () => {
  it('measures an autosave, a list, a tag change, a create, a restore and a style create', async () => {
    const n = (await c.post('/api/notes', { folderId: null })).json();
    await c.patch(`/api/notes/${n.id}`, { tags: ['alpha', 'beta'] });
    let version = (await c.get(`/api/notes/${n.id}`)).json().version;
    const save = (text: string) => c.put(`/api/notes/${n.id}`, { title: 'Plan', body: doc(p(text)), version });
    const saveM = await measure(
      async () => {
        const r = await save('typing more');
        version = r.json().version;
        return r;
      },
      async () => (version = (await save('typing')).json().version),
    );
    report('autosave (PUT /notes/:id)', saveM);
    expect(saveM.status).toBe(200);

    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#3366cc' } }).png().toBuffer();
    const img = [(await upload(c, 'a.png', 'image/png', png)).json(), (await upload(c, 'b.png', 'image/png', png)).json()];
    const withImages = doc(p('pics'), { type: 'image', attrs: { src: img[0].src } }, { type: 'image', attrs: { src: img[1].src } });
    version = (await c.put(`/api/notes/${n.id}`, { title: 'Plan', body: withImages, version })).json().version;
    const imgM = await measure(async () => {
      const r = await c.put(`/api/notes/${n.id}`, { title: 'Plan', body: withImages, version });
      version = r.json().version;
      return r;
    });
    report('autosave with 2 images', imgM);
    expect(imgM.status).toBe(200);

    const listM = await measure(() => c.get('/api/notes?view=all'));
    report('GET /notes (session check + list)', listM);
    const tagM = await measure(() => c.patch(`/api/notes/${n.id}`, { tags: ['alpha', 'gamma', 'delta'] }));
    report('PATCH tags (3)', tagM);
    const createM = await measure(() => c.post('/api/notes', { folderId: null }));
    report('POST /notes', createM);
    await c.post(`/api/notes/${n.id}/trash`);
    const restoreM = await measure(() => c.post(`/api/notes/${n.id}/restore`));
    report('restore', restoreM);
    const style = { name: 'S', font: null, size: 16, bold: true, italic: false, underline: false, strike: false, textColor: null, highlight: null };
    const styleM = await measure(() => c.post('/api/styles', style));
    report('POST /styles', styleM);
    for (const m of [listM, tagM, restoreM]) expect(m.status).toBe(200);
    expect(createM.status).toBe(201);
    expect(styleM.status).toBe(201);
    // CLEANUP-PLAN pass 1 item 1 (before: autosave 12 executed / 12 compiled, with 2 images 15, 3 tags 22,
    // create 12, restore 12, style create 8). Upper bounds, so a later saving does not break them.
    // Item 2: the session check is one query (before: two), so every request is one statement lighter.
    expect(saveM.executed).toBeLessThanOrEqual(8);
    expect(imgM.executed).toBeLessThanOrEqual(9);
    expect(tagM.executed).toBeLessThanOrEqual(9);
    expect(createM.executed).toBeLessThanOrEqual(6);
    expect(restoreM.executed).toBeLessThanOrEqual(7);
    expect(styleM.executed).toBeLessThanOrEqual(6);
    expect(listM.executed).toBeLessThanOrEqual(3); // before: 4
    // Item 2: statements are compiled once and reused: a repeated request compiles nothing (before: 12 per autosave).
    expect(saveM.compiled).toBe(0);
    expect(listM.sql.filter((q) => /FROM sessions/.test(q))).toHaveLength(1);
    expect(listM.sql.some((q) => /FROM users/.test(q) && !/JOIN users/.test(q))).toBe(false);
    // The autosave does not read the note's body or text back, nor rebuild the search entry.
    expect(saveM.sql.some((q) => /SELECT \* FROM notes/.test(q))).toBe(false);
    expect(saveM.sql.some((q) => /SELECT title, body_text/.test(q))).toBe(false);
  });
});

describe('the session check (item 2)', () => {
  it('carries only the id and username on the request: no password hash', async () => {
    const token = c.cookie.split('=')[1];
    expect(Object.keys(env.store.authenticateSession(token)!).sort()).toEqual(['id', 'username']);
  });

  it('runs before the body is parsed: a refused request is not parsed', async () => {
    const bad = '{"title": "unterminated';
    const json = { 'content-type': 'application/json' };
    // No session: refused as unauthorised, not as a body that does not parse.
    const anon = await new Client(env).req('PUT', '/api/notes/x', bad, json);
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error.code).toBe('unauthorized');
    // The wrong tab: refused before parsing too.
    const wrong = await c.req('PUT', '/api/notes/x', bad, { ...json, 'x-notes-user': 'someone-else' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('wrong_user');
    // Signed in properly, the same body is a parse error as before.
    const mine = await c.req('PUT', '/api/notes/x', bad, json);
    expect(mine.statusCode).toBe(400);
  });

  it('a session whose user has gone or is disabled is refused and deleted, as before', async () => {
    const token = c.cookie.split('=')[1];
    env.store.setDisabled('alice', true); // also deletes the sessions
    expect(env.store.authenticateSession(token)).toBeNull();
    expect((await c.get('/api/me')).statusCode).toBe(401);
  });
});

describe('the same answers, with less work', () => {
  const search = async (q: string) => ((await c.post('/api/search', { query: q })).json().results as { id: string }[]).map((r) => r.id);

  it('tags come back in the order a read gives, including characters outside the BMP', async () => {
    const n = (await c.post('/api/notes', { folderId: null })).json();
    const tags = ['zeta', 'émile', 'alpha', '\u{1F600}smile', '\u{FF21}wide', 'Beta'];
    const r = (await c.patch(`/api/notes/${n.id}`, { tags })).json();
    expect(r.tags).toEqual((await c.get(`/api/notes/${n.id}`)).json().tags);
    expect(r.folderId).toBeNull();
  });

  it('search follows saves, tag changes, Trash and restore; a missing index entry is rebuilt', async () => {
    const n = (await c.post('/api/notes', { folderId: null })).json();
    const v = (await c.put(`/api/notes/${n.id}`, { title: 'Harbour', body: doc(p('lighthouse keeper')), version: n.version })).json().version;
    expect(await search('lighthouse')).toEqual([n.id]);
    expect(await search('harbour')).toEqual([n.id]);
    await c.patch(`/api/notes/${n.id}`, { tags: ['seaside'] });
    expect(await search('seaside')).toEqual([n.id]);
    expect(await search('lighthouse')).toEqual([n.id]); // a tag change keeps title and body in the index
    await c.post(`/api/notes/${n.id}/trash`);
    expect(await search('lighthouse')).toEqual([]);
    const restored = (await c.post(`/api/notes/${n.id}/restore`)).json();
    expect(restored).toEqual((await c.get(`/api/notes/${n.id}`)).json()); // the same answer a read gives
    expect(await search('seaside')).toEqual([n.id]);
    // An index entry that has gone missing is rebuilt on the next save.
    env.store['db'].prepare('DELETE FROM notes_fts WHERE rowid = (SELECT seq FROM notes WHERE id = ?)').run(n.id);
    expect(await search('lighthouse')).toEqual([]);
    await c.put(`/api/notes/${n.id}`, { title: 'Harbour', body: doc(p('lighthouse keeper again')), version: v });
    expect(await search('lighthouse')).toEqual([n.id]);
    expect(await search('seaside')).toEqual([n.id]);
  });

  it('a create answers exactly what a read of the new note gives', async () => {
    const f = (await c.post('/api/folders', { name: 'Box', parentId: null })).json();
    const made = (await c.post('/api/notes', { folderId: f.id })).json();
    expect(made).toEqual((await c.get(`/api/notes/${made.id}`)).json());
    expect(JSON.stringify(made)).toBe(JSON.stringify((await c.get(`/api/notes/${made.id}`)).json())); // same key order too
  });

  it('missing images are listed in the note\'s order, in one query', async () => {
    const n = (await c.post('/api/notes', { folderId: null })).json();
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#3366cc' } }).png().toBuffer();
    const mine = (await upload(c, 'a.png', 'image/png', png)).json();
    const ghost = (k: string) => `/api/images/${k}`;
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const body = doc({ type: 'image', attrs: { src: ghost(b) } }, { type: 'image', attrs: { src: mine.src } }, { type: 'image', attrs: { src: ghost(a) } });
    env.sql.reset();
    const r = await c.put(`/api/notes/${n.id}`, { title: '', body, version: n.version });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('image_missing');
    expect(r.json().error.images).toEqual([b, a]);
    expect(env.sql.executed.filter((q) => /FROM images/.test(q))).toHaveLength(1);
  });
});

describe('image clean-up (item 5)', () => {
  it('a permanent delete cleans up only that user\'s images, in one statement; the daily run does everyone', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#3366cc' } }).png().toBuffer();
    const bob = await userClient(env, 'bob');
    const alices = [];
    for (let i = 0; i < 3; i++) alices.push((await upload(c, `a${i}.png`, 'image/png', png)).json());
    const bobs = (await upload(bob, 'b.png', 'image/png', png)).json();
    env.clock.t += 25 * 60 * 60 * 1000; // past the 24-hour grace
    const n = (await c.post('/api/notes', { folderId: null })).json();
    await c.post(`/api/notes/${n.id}/trash`);
    const copyChecks = vi.spyOn(env.store as any, 'copyInProgress');
    env.sql.reset();
    expect((await c.del(`/api/notes/${n.id}`)).statusCode).toBe(200);
    expect(env.sql.executed.filter((q) => /FROM images/.test(q))).toHaveLength(1); // before: a SELECT, then a check and a DELETE per image
    expect(copyChecks).toHaveBeenCalledTimes(1); // before: once per image
    expect((await c.get(alices[0].src)).statusCode).toBe(404);
    expect((await bob.get(bobs.src)).statusCode).toBe(200); // another user's is left to the daily run
    expect(env.store.cleanupImages()).toBe(1);
    expect((await bob.get(bobs.src)).statusCode).toBe(404);
  });
});

