// Acceptance criterion 2: users cannot touch each other's data, even by id.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, userClient, doc, p, type Client, type Env } from './helpers.js';

let env: Env;
let alice: Client;
let bob: Client;
let aNote: string;
let aFolder: string;
let aInbox: string;
beforeEach(async () => {
  env = await makeEnv();
  alice = await userClient(env, 'alice');
  bob = await userClient(env, 'bob');
  aFolder = (await alice.post('/api/folders', { name: 'Secret' })).json().id;
  aNote = (await alice.post('/api/notes', { folderId: aFolder })).json().id;
  await alice.put(`/api/notes/${aNote}`, { title: 'alice secret', body: doc(p('the password is swordfish')), version: 1 });
  await alice.patch(`/api/notes/${aNote}`, { tags: ['private'] });
  aInbox = (await alice.get('/api/me')).json().inboxId;
});
afterEach(async () => env.close());

async function aliceUnchanged() {
  const n = (await alice.get(`/api/notes/${aNote}`)).json();
  expect(n.title).toBe('alice secret');
  expect(n.version).toBe(2);
  expect(n.folderId).toBe(aFolder);
  expect(n.tags).toEqual(['private']);
  expect(n.trashedAt).toBe(null);
  const folders = (await alice.get('/api/folders')).json().folders;
  expect(folders.find((f: any) => f.id === aFolder).name).toBe('Secret');
}

describe('isolation between users', () => {
  it('another user’s note id behaves exactly like a missing one', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    for (const id of [aNote, missing]) {
      const results = [
        await bob.get(`/api/notes/${id}`),
        await bob.put(`/api/notes/${id}`, { title: 'pwned', body: doc(p('x')), version: 2 }),
        await bob.patch(`/api/notes/${id}`, { tags: ['pwned'] }),
        await bob.patch(`/api/notes/${id}`, { folderId: null }),
        await bob.post(`/api/notes/${id}/trash`),
        await bob.post(`/api/notes/${id}/restore`),
        await bob.del(`/api/notes/${id}`),
      ];
      for (const r of results) {
        expect(r.statusCode).toBe(404);
        expect(r.json()).toEqual({ error: { code: 'not_found', message: 'Note not found.' } });
      }
    }
    await aliceUnchanged();
  });

  it('cannot see, rename, move, delete or use another user’s folders', async () => {
    expect((await bob.get(`/api/notes?view=folder&folder=${aFolder}`)).statusCode).toBe(404);
    expect((await bob.patch(`/api/folders/${aFolder}`, { name: 'pwned' })).statusCode).toBe(404);
    expect((await bob.patch(`/api/folders/${aFolder}`, { parentId: null })).statusCode).toBe(404);
    expect((await bob.del(`/api/folders/${aFolder}`)).statusCode).toBe(404);
    expect((await bob.post('/api/folders', { name: 'x', parentId: aFolder })).statusCode).toBe(404);
    expect((await bob.post('/api/notes', { folderId: aFolder })).statusCode).toBe(404);
    expect((await bob.del(`/api/folders/${aInbox}`)).statusCode).toBe(404);
    // Bob cannot move his own note or folder into Alice's folder.
    const bNote = (await bob.post('/api/notes', {})).json().id;
    expect((await bob.patch(`/api/notes/${bNote}`, { folderId: aFolder })).statusCode).toBe(404);
    expect((await bob.patch(`/api/notes/${bNote}`, { folderId: aInbox })).statusCode).toBe(404);
    const bFolder = (await bob.post('/api/folders', { name: 'Mine' })).json().id;
    expect((await bob.patch(`/api/folders/${bFolder}`, { parentId: aFolder })).statusCode).toBe(404);
    // Alice cannot move hers into Bob's either.
    expect((await alice.patch(`/api/notes/${aNote}`, { folderId: bFolder })).statusCode).toBe(404);
    const bobFolders = JSON.stringify((await bob.get('/api/folders')).json());
    expect(bobFolders).not.toContain(aFolder);
    expect(bobFolders).not.toContain('Secret');
    await aliceUnchanged();
  });

  it('lists, tags, search and Trash show only the user’s own data', async () => {
    expect((await bob.get('/api/notes')).json().notes).toEqual([]);
    expect((await bob.get('/api/notes?view=tag&tag=private')).json().notes).toEqual([]);
    expect((await bob.get('/api/tags')).json().tags).toEqual([]);
    expect((await bob.post('/api/search', { query: 'swordfish' })).json().results).toEqual([]);
    expect((await bob.post('/api/search', { query: 'swordfish', tag: 'private' })).json().results).toEqual([]);
    await alice.post(`/api/notes/${aNote}/trash`);
    expect((await bob.get('/api/notes?view=trash')).json().notes).toEqual([]);
    expect((await bob.del('/api/trash')).json().deleted).toBe(0);
    expect((await alice.get('/api/notes?view=trash')).json().notes).toHaveLength(1);
    expect((await bob.get('/api/me')).json().storageUsed).toBeLessThan((await alice.get('/api/me')).json().storageUsed);
  });
});
