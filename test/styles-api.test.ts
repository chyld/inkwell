// /api/styles (STYLES-SPEC 4, 6, 11): criteria 1, 2, 4, 10 (server side), 17, 18 and 19 (logs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAGE_CSP } from '../src/server/http.js';
import { markdownToDoc } from '../src/server/markdown.js';
import { noteSchema, validateBody } from '../src/shared/schema.js';
import { fontById } from '../src/shared/fonts.js';
import { fullDoc } from './fixtures/full-note.js';
import { makeEnv, userClient, ORIGIN, type Client, type Env } from './helpers.js';

let env: Env;
let alice: Client;
let bob: Client;
beforeEach(async () => {
  env = await makeEnv();
  alice = await userClient(env, 'alice');
  bob = await userClient(env, 'bob');
});
afterEach(async () => env.close());

const style = (over: Record<string, unknown> = {}) => ({ name: 'Body', font: null, size: 16, bold: false, italic: false, underline: false, strike: false, textColor: null, highlight: null, ...over });
const create = (c: Client, over: Record<string, unknown> = {}) => c.post('/api/styles', style(over));
const list = async (c: Client) => (await c.get('/api/styles')).json() as Record<string, unknown>[];

describe('creating and listing (criterion 1)', () => {
  it('stores and returns what was sent, with the name trimmed', async () => {
    const full = style({ name: '  Callout  ', font: 'lora', size: 22, bold: true, italic: true, underline: true, strike: true, textColor: 'ruby', highlight: 'topaz' });
    const r = await alice.post('/api/styles', full);
    expect(r.statusCode, r.body).toBe(201);
    const s = r.json();
    expect(s).toEqual({ ...full, name: 'Callout', id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(await list(alice)).toEqual([s]);
  });

  it('lists in order of name key (trimmed, lower-cased), then id; non-ASCII names included', async () => {
    for (const name of ['zebra', 'Émile', 'apple', 'Banana', 'émigré', 'Ångström', 'éclair']) expect((await create(alice, { name })).statusCode).toBe(201);
    const names = (await list(alice)).map((s) => s.name as string);
    const expected = [...names].sort((a, b) => {
      const ka = a.toLowerCase();
      const kb = b.toLowerCase();
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    expect(names).toEqual(expected);
    expect(names.slice(0, 3)).toEqual(['apple', 'Banana', 'zebra']);
  });

  it('a style may hold a retired font and a font outside the collection (criterion 3, server side)', async () => {
    const f = fontById('lora')! as { retired: boolean };
    f.retired = true;
    try {
      const r = await create(alice, { name: 'Old', font: 'lora' });
      expect(r.statusCode, r.body).toBe(201);
      const id = r.json().id;
      expect((await alice.put(`/api/styles/${id}`, style({ name: 'Old', font: 'lora', size: 20 }))).statusCode).toBe(200);
    } finally {
      f.retired = false;
    }
    expect(env.store.fonts.collection(alice.userId)).toEqual([]); // the collection is never consulted
    expect((await create(alice, { name: 'Caveat', font: 'caveat' })).statusCode).toBe(201);
  });
});

describe('refusals (criterion 2)', () => {
  const refused = async (body: unknown, code: string, message: RegExp) => {
    const r = await alice.post('/api/styles', body);
    expect(r.statusCode, JSON.stringify(body)).toBe(400);
    expect(r.json().error.code, JSON.stringify(body)).toBe(code);
    expect(r.json().error.message, JSON.stringify(body)).toMatch(message);
  };

  it('a missing or extra field, naming it', async () => {
    for (const k of ['name', 'font', 'size', 'bold', 'italic', 'underline', 'strike', 'textColor', 'highlight']) {
      const b: Record<string, unknown> = style();
      delete b[k];
      await refused(b, 'invalid_style', new RegExp(`"${k}"`));
    }
    await refused({ ...style(), color: 'ruby' }, 'invalid_style', /"color"/);
    await refused({ ...style(), id: '00000000-0000-4000-8000-000000000000' }, 'invalid_style', /"id"/);
    await refused([style()], 'invalid_style', /style object/);
  });

  it('a bad name: empty after trimming, over 50 code points, a control character', async () => {
    await refused(style({ name: '   ' }), 'invalid_name', /Give the style a name/);
    await refused(style({ name: '' }), 'invalid_name', /name/);
    await refused(style({ name: 'x'.repeat(51) }), 'invalid_name', /at most 50/);
    expect((await create(alice, { name: '😀'.repeat(50) })).statusCode).toBe(201); // 50 code points (100 UTF-16 units)
    await refused(style({ name: '😀'.repeat(51) }), 'invalid_name', /at most 50/);
    for (const c of ['\u0000', '\t', '\n', '\u001f', '\u007f', '\u0085', '\u009f']) await refused(style({ name: `a${c}b` }), 'invalid_name', /not allowed/);
    await refused(style({ name: 7 }), 'invalid_style', /"name"/);
  });

  it('a bad size, colour, highlight, font or flag', async () => {
    for (const size of [7, 97, 16.5, '16', null, 0, -1]) await refused(style({ size }), 'invalid_style', /"size"/);
    for (const textColor of ['red', 'topaz', 'Ruby', '#ff0000', 1]) await refused(style({ textColor }), 'invalid_style', /"textColor"/);
    for (const highlight of ['yellow', 'onyx', '#ffff00']) await refused(style({ highlight }), 'invalid_style', /"highlight"/);
    for (const font of ['no-such-font', 'Lora', '../x', '', 'inter-x']) await refused(style({ font }), 'invalid_style', /"font"/);
    for (const k of ['bold', 'italic', 'underline', 'strike']) await refused(style({ [k]: 1 }), 'invalid_style', new RegExp(`"${k}"`));
  });

  it('a duplicate name in another capitalisation; renaming to another capitalisation of its own name succeeds', async () => {
    const a = (await create(alice, { name: 'Heading' })).json();
    const r = await create(alice, { name: '  HEADING ' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'name_taken', message: 'You already have a style with that name.' });
    const b = (await create(alice, { name: 'Other' })).json();
    expect((await alice.put(`/api/styles/${b.id}`, style({ name: 'heading' }))).statusCode).toBe(409);
    const renamed = await alice.put(`/api/styles/${a.id}`, style({ name: 'HEADING', bold: true }));
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ id: a.id, name: 'HEADING', bold: true });
    // Another user may use the same name.
    expect((await create(bob, { name: 'Heading' })).statusCode).toBe(201);
  });

  it('two parallel creates of one name: one 201, one 409', async () => {
    const rs = await Promise.all([create(alice, { name: 'Twin' }), create(alice, { name: 'twin' })]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect((await list(alice)).length).toBe(1);
  });

  it('the 51st style, and ten parallel creates at 49 (exactly one succeeds)', async () => {
    for (let i = 0; i < 49; i++) expect((await create(alice, { name: `S${i}` })).statusCode).toBe(201);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => create(alice, { name: `P${i}` })));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    expect(rs.filter((r) => r.statusCode === 409).every((r) => r.json().error.code === 'styles_full')).toBe(true);
    const r = await create(alice, { name: 'One more' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'styles_full', message: 'You can keep at most 50 styles. Delete one to add another.' });
    expect((await list(alice)).length).toBe(50);
    // Replacing still works at 50; deleting one allows another.
    const first = (await list(alice))[0];
    expect((await alice.put(`/api/styles/${first.id}`, style({ name: 'Renamed' }))).statusCode).toBe(200);
    expect((await alice.del(`/api/styles/${first.id}`)).statusCode).toBe(200);
    expect((await create(alice, { name: 'One more' })).statusCode).toBe(201);
  });
});

describe('privacy and deletion (criterion 4)', () => {
  it("another user's GET does not include the style; their PUT is 404; their DELETE is 200 and changes nothing", async () => {
    const s = (await create(alice, { name: 'Mine', bold: true })).json();
    expect(await list(bob)).toEqual([]);
    expect((await bob.put(`/api/styles/${s.id}`, style({ name: 'Stolen' }))).statusCode).toBe(404);
    const d = await bob.del(`/api/styles/${s.id}`);
    expect(d.statusCode).toBe(200);
    expect(d.json()).toEqual({ ok: true });
    expect(await list(alice)).toEqual([s]);
    expect((await alice.put('/api/styles/00000000-0000-4000-8000-000000000000', style())).statusCode).toBe(404);
    expect((await alice.put('/api/styles/not-a-uuid', style())).statusCode).toBe(404);
    expect((await alice.del('/api/styles/not-a-uuid')).statusCode).toBe(200);
    expect((await alice.del(`/api/styles/${s.id}`)).statusCode).toBe(200);
    expect(await list(alice)).toEqual([]);
  });

  it('deleting a user removes their styles; notes data copy includes them', async () => {
    await create(alice, { name: 'A' });
    await create(bob, { name: 'B' });
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'styles-copy-')), 'copy');
    try {
      await env.store.copy.dataCopy(out);
      const copy = new Database(path.join(out, 'notes.db'), { readonly: true });
      expect(copy.prepare('SELECT name FROM styles ORDER BY name').all()).toEqual([{ name: 'A' }, { name: 'B' }]);
      copy.close();
    } finally {
      fs.rmSync(path.dirname(out), { recursive: true, force: true });
    }
    env.store.identity.deleteUser('alice');
    expect(env.store.db.prepare('SELECT name FROM styles').all()).toEqual([{ name: 'B' }]);
  });
});

describe('a style is a stamp (criterion 10, server side)', () => {
  it('editing or deleting a style changes no note', async () => {
    const s = (await create(alice, { name: 'Loud', size: 24, bold: true, textColor: 'ruby' })).json();
    const n = (await alice.post('/api/notes', { folderId: null })).json();
    const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'styled', marks: [{ type: 'bold' }, { type: 'textColor', attrs: { color: 'ruby' } }, { type: 'fontSize', attrs: { size: 24 } }] }] }] };
    expect((await alice.put(`/api/notes/${n.id}`, { title: 'x', body, version: 1 })).statusCode).toBe(200);
    const before = (await alice.get(`/api/notes/${n.id}`)).json();
    expect((await alice.put(`/api/styles/${s.id}`, style({ name: 'Quiet', size: 12 }))).statusCode).toBe(200);
    expect((await alice.get(`/api/notes/${n.id}`)).json()).toEqual(before);
    expect((await alice.del(`/api/styles/${s.id}`)).statusCode).toBe(200);
    expect((await alice.get(`/api/notes/${n.id}`)).json()).toEqual(before);
  });
});

describe('the note schema is unchanged (criterion 17)', () => {
  it('nodes, marks, mark attributes and the exclusion of marks in code are exactly as before', () => {
    const s = noteSchema();
    expect(Object.keys(s.nodes).sort()).toEqual(['blockquote', 'bulletList', 'codeBlock', 'doc', 'hardBreak', 'heading', 'horizontalRule', 'image', 'listItem', 'orderedList', 'paragraph', 'table', 'tableCell', 'tableHeader', 'tableRow', 'taskItem', 'taskList', 'text'].sort());
    const marks = Object.fromEntries(Object.entries(s.marks).map(([k, m]) => [k, Object.keys(m.spec.attrs ?? {}).sort()]));
    expect(marks).toEqual({ bold: [], code: [], fontFamily: ['font'], fontSize: ['size'], highlight: ['color'], italic: [], link: ['class', 'href', 'rel', 'target', 'title'], strike: [], textColor: ['color'], underline: [] });
    expect(s.marks.code.spec.excludes).toBe('_');
    expect(s.nodes.codeBlock.spec.marks).toBe('');
  });

  it('a fixture of accepted and rejected notes behaves as before; a note carrying any style field is rejected', () => {
    expect(() => validateBody(fullDoc('/api/images/0b5c3a1e-7f2d-4c4e-9a7b-2d1f0e9c8b7a'))).not.toThrow();
    const p = (marks: unknown[], extra: Record<string, unknown> = {}) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks, ...extra }] }] });
    const rejected: [string, unknown][] = [
      ['a style mark', p([{ type: 'style', attrs: { id: '00000000-0000-4000-8000-000000000000' } }])],
      ['a styleId mark attribute', p([{ type: 'bold', attrs: { styleId: 'x' } }])],
      ['a style attribute on a colour', p([{ type: 'textColor', attrs: { color: 'ruby', style: 'Callout' } }])],
      ['a style key on a text node', p([], { style: 'Callout' })],
      ['a style attribute on a paragraph', { type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'Callout' }, content: [{ type: 'text', text: 'x' }] }] }],
      ['a name on a size', p([{ type: 'fontSize', attrs: { size: 18, name: 'Big' } }])],
      ['an unknown mark', p([{ type: 'subscript' }])],
      ['a size out of range', p([{ type: 'fontSize', attrs: { size: 100 } }])],
      ['a colour in code', p([{ type: 'code' }, { type: 'textColor', attrs: { color: 'ruby' } }])],
    ];
    for (const [what, doc] of rejected) expect(() => validateBody(doc), what).toThrow();
  });

  it('the Markdown converter produces only the marks it always did; the CSP has its exact value', () => {
    const json = JSON.stringify(markdownToDoc('**b** *i* ~~s~~ `c` [l](https://example.com) <span data-font-size="40">x</span>'));
    const types = [...json.matchAll(/"type":"(\w+)"/g)].map((m) => m[1]);
    expect(new Set(types.filter((t) => ['bold', 'italic', 'strike', 'code', 'link', 'fontSize', 'fontFamily', 'textColor', 'highlight', 'underline'].includes(t)))).toEqual(new Set(['bold', 'italic', 'strike', 'code', 'link']));
    expect(PAGE_CSP).toBe(
      "default-src 'self'; script-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  });
});

describe('Origin, session, X-Notes-User and no-store on every answer (criterion 18)', () => {
  it('every route and every status', async () => {
    const s = (await create(alice, { name: 'Probe' })).json();
    const noStore = (r: { headers: Record<string, unknown>; statusCode: number }, what: string) => expect(r.headers['cache-control'], `${what} ${r.statusCode}`).toBe('private, no-store');
    const routes: [string, string, unknown][] = [
      ['POST', '/api/styles', style({ name: 'New' })],
      ['PUT', `/api/styles/${s.id}`, style({ name: 'Probe' })],
      ['DELETE', `/api/styles/${s.id}`, undefined],
    ];
    for (const [method, url, body] of routes) {
      // A wrong or missing Origin: 403, before the session is looked at (also without a session).
      for (const origin of ['https://evil.example', '']) {
        noStore(await alice.req(method, url, body, { origin }), `${method} origin=${origin}`);
        expect((await alice.req(method, url, body, { origin })).statusCode).toBe(403);
        const anon = await env.app.inject({ method: method as 'POST', url, payload: body as object, headers: origin ? { origin } : {} });
        expect(anon.statusCode).toBe(403);
        noStore(anon, 'anon');
      }
      // A good Origin and no session; a missing or mismatched X-Notes-User: 401.
      const noSession = await env.app.inject({ method: method as 'POST', url, payload: body as object, headers: { origin: ORIGIN } });
      expect(noSession.statusCode).toBe(401);
      noStore(noSession, 'no session');
      for (const who of ['', bob.userId]) {
        const r = await alice.req(method, url, body, { 'x-notes-user': who });
        expect(r.statusCode, `${method} ${url} x-notes-user=${who}`).toBe(401);
        noStore(r, 'x-notes-user');
      }
    }
    for (const who of ['', bob.userId]) {
      const r = await alice.req('GET', '/api/styles', undefined, { 'x-notes-user': who });
      expect(r.statusCode).toBe(401);
      noStore(r, 'GET 401');
    }
    expect((await env.app.inject({ method: 'GET', url: '/api/styles' })).statusCode).toBe(401);
    // 200, 201, 400, 404, 409.
    const answers = [
      await alice.get('/api/styles'),
      await create(alice, { name: 'Fresh' }),
      await create(alice, { name: '' }),
      await alice.put('/api/styles/00000000-0000-4000-8000-000000000000', style()),
      await create(alice, { name: 'fresh' }),
      await alice.del(`/api/styles/${s.id}`),
    ];
    expect(answers.map((r) => r.statusCode)).toEqual([200, 201, 400, 404, 409, 200]);
    for (const r of answers) noStore(r, 'answer');
    // Nothing changed by the refused requests.
    expect((await list(alice)).map((x) => x.name)).toEqual(['Fresh']);
  });
});

describe('names and settings never reach the logs (criterion 19, server side)', () => {
  it('after creating, failing to create, editing and deleting a style named with HTML and CSS metacharacters', async () => {
    const name = '<b onclick="x()">Zq</b>{color:red}';
    const s = (await create(alice, { name, textColor: 'amethyst', highlight: 'peridot', font: 'caveat', size: 77 })).json();
    expect(s.name).toBe(name);
    await create(alice, { name }); // 409
    await create(alice, { name: `${name}\u0000` }); // 400
    await alice.put(`/api/styles/${s.id}`, style({ name: `${name} 2`, textColor: 'garnet' }));
    await alice.del(`/api/styles/${s.id}`);
    const logs = env.logs();
    expect(logs).toContain('/api/styles');
    // (A number such as the size is not checked: request durations are numbers too.)
    for (const needle of ['onclick', 'Zq', 'color:red', 'amethyst', 'peridot', 'caveat', 'garnet', '"size"', 'textColor', 'highlight"']) expect(logs, needle).not.toContain(needle);
  });
});
