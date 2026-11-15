// Acceptance criterion 7.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, userClient, doc, p, type Client, type Env } from './helpers.js';

let env: Env;
let c: Client;
beforeEach(async () => {
  env = await makeEnv();
  c = await userClient(env, 'alice');
});
afterEach(async () => env.close());

describe('versions and conflicts', () => {
  it('two saves from the same version: one succeeds, one gets 409 with the current version', async () => {
    const n = (await c.post('/api/notes', {})).json();
    expect(n.version).toBe(1);
    const [r1, r2] = await Promise.all([
      c.put(`/api/notes/${n.id}`, { title: 'tab A', body: doc(p('from A')), version: 1 }),
      c.put(`/api/notes/${n.id}`, { title: 'tab B', body: doc(p('from B')), version: 1 }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = r1.statusCode === 409 ? r1 : r2;
    expect(loser.json().error.code).toBe('version_conflict');
    expect(loser.json().error.version).toBe(2);
  });

  it('"keep mine" saves again with the version from the 409 and wins', async () => {
    const n = (await c.post('/api/notes', {})).json();
    await c.put(`/api/notes/${n.id}`, { title: 'theirs', body: doc(p('theirs')), version: 1 });
    const conflict = await c.put(`/api/notes/${n.id}`, { title: 'mine', body: doc(p('mine')), version: 1 });
    expect(conflict.statusCode).toBe(409);
    const v = conflict.json().error.version;
    const keep = await c.put(`/api/notes/${n.id}`, { title: 'mine', body: doc(p('mine')), version: v });
    expect(keep.statusCode).toBe(200);
    expect(keep.json().version).toBe(3);
    const now = (await c.get(`/api/notes/${n.id}`)).json();
    expect(now.title).toBe('mine');
    expect(now.body).toEqual((await c.get(`/api/notes/${n.id}`)).json().body);
    expect(now.version).toBe(3);
  });

  it('"load theirs" reloads the server copy, which then saves normally', async () => {
    const n = (await c.post('/api/notes', {})).json();
    await c.put(`/api/notes/${n.id}`, { title: 'theirs', body: doc(p('theirs')), version: 1 });
    expect((await c.put(`/api/notes/${n.id}`, { title: 'mine', body: doc(p('mine')), version: 1 })).statusCode).toBe(409);
    const theirs = (await c.get(`/api/notes/${n.id}`)).json();
    expect(theirs.title).toBe('theirs');
    expect(theirs.version).toBe(2);
    const next = await c.put(`/api/notes/${n.id}`, { title: 'theirs edited', body: theirs.body, version: theirs.version });
    expect(next.statusCode).toBe(200);
    expect(next.json().version).toBe(3);
  });

  it('changing tags or folder while the note is being edited causes no 409 and keeps the version', async () => {
    const n = (await c.post('/api/notes', {})).json();
    const f = (await c.post('/api/folders', { name: 'F' })).json().id;
    expect((await c.patch(`/api/notes/${n.id}`, { tags: ['x'] })).statusCode).toBe(200);
    expect((await c.patch(`/api/notes/${n.id}`, { folderId: f })).statusCode).toBe(200);
    await c.post(`/api/notes/${n.id}/trash`);
    await c.post(`/api/notes/${n.id}/restore`);
    expect((await c.get(`/api/notes/${n.id}`)).json().version).toBe(1);
    const save = await c.put(`/api/notes/${n.id}`, { title: 't', body: doc(p('b')), version: 1 });
    expect(save.statusCode).toBe(200);
    const after = (await c.get(`/api/notes/${n.id}`)).json();
    expect(after.tags).toEqual(['x']);
    expect(after.folderId).toBe(f);
  });

  it('rejects invalid bodies with 400 and changes nothing', async () => {
    const n = (await c.post('/api/notes', {})).json();
    const bad = [
      { type: 'doc', content: [{ type: 'script', text: 'x' }] },
      { type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'x' } }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }] }] },
      { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/x.png' } }] },
      { type: 'doc', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } }] },
      { type: 'doc', content: [{ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'x' }] }] },
      { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [p('x')] }] }] }] },
      { type: 'paragraph' },
      'not an object',
    ];
    for (const body of bad) {
      const r = await c.put(`/api/notes/${n.id}`, { title: 'x', body, version: 1 });
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await c.put(`/api/notes/${n.id}`, { title: 'x'.repeat(201), body: doc(p('x')), version: 1 })).statusCode).toBe(400);
    expect((await c.get(`/api/notes/${n.id}`)).json().version).toBe(1);
  });

  it('rejects a body over 1 MB', async () => {
    const n = (await c.post('/api/notes', {})).json();
    const big = doc(p('x'.repeat(1024 * 1024)));
    const r = await c.put(`/api/notes/${n.id}`, { title: 'x', body: big, version: 1 });
    expect(r.statusCode).toBe(400);
  });
});
