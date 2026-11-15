// Acceptance criterion 13.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, userClient, doc, p, type Client, type Env } from './helpers.js';

let env: Env;
let c: Client;
beforeEach(async () => {
  env = await makeEnv();
  c = await userClient(env, 'alice');
});
afterEach(async () => env.close());

async function folder(name: string, parentId: string | null = null) {
  const r = await c.post('/api/folders', { name, parentId });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
}
async function note(folderId: string | null, text = 'hello') {
  const n = (await c.post('/api/notes', { folderId })).json();
  const r = await c.put(`/api/notes/${n.id}`, { title: text, body: doc(p(text)), version: 1 });
  expect(r.statusCode, r.body).toBe(200);
  return n.id as string;
}

describe('folders', () => {
  it('every user has a protected Inbox', async () => {
    const tree = (await c.get('/api/folders')).json().folders;
    const inbox = tree.find((f: any) => f.isInbox);
    expect(inbox.name).toBe('Inbox');
    expect((await c.patch(`/api/folders/${inbox.id}`, { name: 'Other' })).statusCode).toBe(400);
    const f = await folder('Work');
    expect((await c.patch(`/api/folders/${inbox.id}`, { parentId: f })).statusCode).toBe(400);
    expect((await c.del(`/api/folders/${inbox.id}`)).statusCode).toBe(400);
    expect((await c.post('/api/folders', { name: 'Sub', parentId: inbox.id })).statusCode).toBe(400);
    expect((await c.patch(`/api/folders/${f}`, { parentId: inbox.id })).statusCode).toBe(400);
  });

  it('limits depth to 10, on create and on move', async () => {
    let parent: string | null = null;
    const chain: string[] = [];
    for (let i = 1; i <= 10; i++) {
      parent = await folder(`L${i}`, parent);
      chain.push(parent);
    }
    expect((await c.post('/api/folders', { name: 'L11', parentId: parent })).statusCode).toBe(400);
    // A two-level subtree cannot be moved under level 9.
    const a = await folder('A');
    await folder('B', a);
    expect((await c.patch(`/api/folders/${a}`, { parentId: chain[8] })).statusCode).toBe(400);
    expect((await c.patch(`/api/folders/${a}`, { parentId: chain[7] })).statusCode).toBe(200);
  });

  it('sibling names are unique without regard to case, and may repeat elsewhere', async () => {
    const w = await folder('Work');
    expect((await c.post('/api/folders', { name: 'work' })).statusCode).toBe(409);
    expect((await c.post('/api/folders', { name: 'WORK', parentId: w })).statusCode).toBe(201);
    const x = await folder('Other');
    expect((await c.patch(`/api/folders/${x}`, { name: 'wOrK' })).statusCode).toBe(409);
    expect((await c.post('/api/folders', { name: 'inbox' })).statusCode).toBe(409);
    expect((await c.post('/api/folders', { name: '' })).statusCode).toBe(400);
    expect((await c.post('/api/folders', { name: 'x'.repeat(101) })).statusCode).toBe(400);
    expect((await c.post('/api/folders', { name: 'x'.repeat(100) })).statusCode).toBe(201);
  });

  it('cannot be moved into itself or a descendant', async () => {
    const a = await folder('A');
    const b = await folder('B', a);
    const cc = await folder('C', b);
    expect((await c.patch(`/api/folders/${a}`, { parentId: a })).statusCode).toBe(400);
    expect((await c.patch(`/api/folders/${a}`, { parentId: cc })).statusCode).toBe(400);
    expect((await c.patch(`/api/folders/${cc}`, { parentId: null })).statusCode).toBe(200);
  });

  it('only an empty folder can be deleted; trashed notes in it become unfiled', async () => {
    const a = await folder('A');
    const b = await folder('B', a);
    expect((await c.del(`/api/folders/${a}`)).statusCode).toBe(409);
    const n = await note(b);
    expect((await c.del(`/api/folders/${b}`)).statusCode).toBe(409);
    await c.post(`/api/notes/${n}/trash`);
    expect((await c.del(`/api/folders/${b}`)).statusCode).toBe(200);
    expect((await c.get(`/api/notes/${n}`)).json().folderId).toBe(null);
    await c.post(`/api/notes/${n}/restore`);
    const unfiled = (await c.get('/api/notes?view=unfiled')).json().notes;
    expect(unfiled.map((x: any) => x.id)).toContain(n);
    expect((await c.del(`/api/folders/${a}`)).statusCode).toBe(200);
  });

  it('notes move between folders with PATCH and appear in the right views', async () => {
    const a = await folder('A');
    const n = await note(null);
    expect((await c.patch(`/api/notes/${n}`, { folderId: a })).json().folderId).toBe(a);
    expect((await c.get(`/api/notes?view=folder&folder=${a}`)).json().notes).toHaveLength(1);
    expect((await c.get('/api/notes?view=unfiled')).json().notes).toHaveLength(0);
    const inbox = (await c.get('/api/me')).json().inboxId;
    await c.patch(`/api/notes/${n}`, { folderId: inbox });
    expect((await c.get('/api/notes?view=inbox')).json().notes).toHaveLength(1);
  });
});

describe('Trash', () => {
  it('hides trashed notes from every view and search, and they cannot be edited', async () => {
    const a = await folder('A');
    const n = await note(a, 'zebra');
    await c.patch(`/api/notes/${n}`, { tags: ['stripes'] });
    expect((await c.post(`/api/notes/${n}/trash`)).statusCode).toBe(200);
    for (const url of ['/api/notes', '/api/notes?view=all', `/api/notes?view=folder&folder=${a}`, '/api/notes?view=tag&tag=stripes', '/api/notes?view=unfiled']) {
      expect((await c.get(url)).json().notes, url).toHaveLength(0);
    }
    expect((await c.post('/api/search', { query: 'zebra' })).json().results).toHaveLength(0);
    expect((await c.post('/api/search', { query: 'stripes' })).json().results).toHaveLength(0);
    expect((await c.get('/api/tags')).json().tags).toEqual([]);
    const trash = (await c.get('/api/notes?view=trash')).json().notes;
    expect(trash.map((x: any) => x.id)).toEqual([n]);
    // Keeps folder and tags while in Trash.
    const full = (await c.get(`/api/notes/${n}`)).json();
    expect(full.folderId).toBe(a);
    expect(full.tags).toEqual(['stripes']);
    expect(full.trashedAt).not.toBe(null);
    expect((await c.put(`/api/notes/${n}`, { title: 'x', body: doc(p('x')), version: full.version })).statusCode).toBe(409);
    expect((await c.patch(`/api/notes/${n}`, { tags: [] })).statusCode).toBe(409);
  });

  it('restore returns the note to its folder, and to unfiled if the folder is gone', async () => {
    const a = await folder('A');
    const n = await note(a, 'zebra');
    await c.post(`/api/notes/${n}/trash`);
    await c.post(`/api/notes/${n}/restore`);
    expect((await c.get(`/api/notes/${n}`)).json().folderId).toBe(a);
    expect((await c.post('/api/search', { query: 'zebra' })).json().results).toHaveLength(1);
  });

  it('permanent delete only from Trash; Empty Trash deletes all trashed notes', async () => {
    const n1 = await note(null, 'one');
    const n2 = await note(null, 'two');
    const n3 = await note(null, 'three');
    expect((await c.del(`/api/notes/${n1}`)).statusCode).toBe(409);
    await c.post(`/api/notes/${n1}/trash`);
    await c.post(`/api/notes/${n2}/trash`);
    expect((await c.del(`/api/notes/${n1}`)).statusCode).toBe(200);
    expect((await c.get(`/api/notes/${n1}`)).statusCode).toBe(404);
    const emptied = (await c.del('/api/trash')).json();
    expect(emptied.deleted).toBe(1);
    expect(emptied.deletedIds).toEqual([n2]); // so the browser can drop those notes' local drafts
    expect((await c.get(`/api/notes/${n2}`)).statusCode).toBe(404);
    expect((await c.get(`/api/notes/${n3}`)).statusCode).toBe(200);
    expect((await c.get('/api/notes?view=trash')).json().notes).toHaveLength(0);
  });

  it('nothing leaves Trash automatically', async () => {
    const n = await note(null);
    await c.post(`/api/notes/${n}/trash`);
    env.clock.t += 400 * 24 * 3600 * 1000;
    env.store.cleanupImages();
    env.store.purgeExpiredSessions();
    const c2 = await userClient(env, 'alice');
    expect((await c2.get('/api/notes?view=trash')).json().notes).toHaveLength(1);
  });
});

describe('tags', () => {
  it('normalises tags, limits to 20, and lists only tags used outside Trash', async () => {
    const n = await note(null);
    const r = await c.patch(`/api/notes/${n}`, { tags: ['  Work ', 'work', 'Ünïcode'] });
    expect(r.json().tags).toEqual(['work', 'ünïcode'].sort());
    expect((await c.patch(`/api/notes/${n}`, { tags: ['a,b'] })).statusCode).toBe(400);
    expect((await c.patch(`/api/notes/${n}`, { tags: [''] })).statusCode).toBe(400);
    expect((await c.patch(`/api/notes/${n}`, { tags: ['x'.repeat(51)] })).statusCode).toBe(400);
    expect((await c.patch(`/api/notes/${n}`, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).statusCode).toBe(400);
    expect((await c.patch(`/api/notes/${n}`, { tags: Array.from({ length: 20 }, (_, i) => `t${i}`) })).statusCode).toBe(200);
    expect((await c.get('/api/tags')).json().tags).toHaveLength(20);
    await c.patch(`/api/notes/${n}`, { tags: ['solo'] });
    expect((await c.get('/api/tags')).json().tags).toEqual([{ name: 'solo', count: 1 }]);
    // Tag rows with no note at all are deleted.
    expect(env.store.db.prepare('SELECT count(*) c FROM tags').get()).toEqual({ c: 1 });
    await c.post(`/api/notes/${n}/trash`);
    expect(env.store.db.prepare('SELECT count(*) c FROM tags').get()).toEqual({ c: 1 });
    await c.del(`/api/notes/${n}`);
    expect(env.store.db.prepare('SELECT count(*) c FROM tags').get()).toEqual({ c: 0 });
  });

  it('pages the note list 50 at a time, newest update first', async () => {
    for (let i = 0; i < 55; i++) {
      env.clock.t += 1000;
      await c.post('/api/notes', {});
    }
    const first = (await c.get('/api/notes')).json();
    expect(first.notes).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = (await c.get(`/api/notes?cursor=${first.nextCursor}`)).json();
    expect(second.notes).toHaveLength(5);
    expect(second.nextCursor).toBe(null);
    const all = [...first.notes, ...second.notes].map((n: any) => n.updatedAt);
    expect([...all].sort().reverse()).toEqual(all);
    expect(new Set([...first.notes, ...second.notes].map((n: any) => n.id)).size).toBe(55);
  });
});
