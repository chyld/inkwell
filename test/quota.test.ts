// Acceptance criterion 14 (browser saves; agent notes are in mcp.test.ts, uploads in images.test.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, userClient, doc, p, type Client, type Env } from './helpers.js';

let env: Env;
let c: Client;
beforeEach(async () => {
  env = await makeEnv({ NOTES_USER_QUOTA_MB: '1' });
  c = await userClient(env, 'alice');
});
afterEach(async () => env.close());

describe('storage limit', () => {
  it('rejects a save that would exceed the limit with 413 and writes nothing', async () => {
    const a = (await c.post('/api/notes', {})).json();
    expect((await c.put(`/api/notes/${a.id}`, { title: 'a', body: doc(p('x'.repeat(700_000))), version: 1 })).statusCode).toBe(200);
    const b = (await c.post('/api/notes', {})).json();
    await c.patch(`/api/notes/${b.id}`, { tags: ['keep'] });
    const used = (await c.get('/api/me')).json().storageUsed;
    const r = await c.put(`/api/notes/${b.id}`, { title: 'b', body: doc(p('y'.repeat(400_000))), version: 1 });
    expect(r.statusCode).toBe(413);
    expect(r.json().error.code).toBe('storage_limit');
    const after = (await c.get(`/api/notes/${b.id}`)).json();
    expect(after.version).toBe(1);
    expect(after.title).toBe('');
    expect((await c.get('/api/me')).json().storageUsed).toBe(used);
    expect((await c.post('/api/search', { query: 'yyyy' })).json().results).toEqual([]);
  });

  it('counts notes in Trash, and existing notes stay readable, trashable and deletable', async () => {
    const a = (await c.post('/api/notes', {})).json();
    await c.put(`/api/notes/${a.id}`, { title: 'a', body: doc(p('x'.repeat(1_000_000))), version: 1 });
    await c.post(`/api/notes/${a.id}/trash`);
    const b = (await c.post('/api/notes', {})).json();
    expect((await c.put(`/api/notes/${b.id}`, { title: 'b', body: doc(p('y'.repeat(100_000))), version: 1 })).statusCode).toBe(413);
    expect((await c.get(`/api/notes/${a.id}`)).statusCode).toBe(200);
    expect((await c.del(`/api/notes/${a.id}`)).statusCode).toBe(200);
    expect((await c.put(`/api/notes/${b.id}`, { title: 'b', body: doc(p('y'.repeat(100_000))), version: 1 })).statusCode).toBe(200);
  });

  it('a save that shrinks a note is allowed even when over the limit', async () => {
    const a = (await c.post('/api/notes', {})).json();
    await c.put(`/api/notes/${a.id}`, { title: 'a', body: doc(p('x'.repeat(1_040_000))), version: 1 });
    env.store.opts.userQuotaBytes = 500_000; // the limit was lowered after the fact
    expect((await c.put(`/api/notes/${a.id}`, { title: 'a', body: doc(p('x'.repeat(1_041_000))), version: 2 })).statusCode).toBe(413);
    expect((await c.put(`/api/notes/${a.id}`, { title: 'a', body: doc(p('short')), version: 2 })).statusCode).toBe(200);
  });

  it('reports storage used and the limit in /me', async () => {
    const me = (await c.get('/api/me')).json();
    expect(me.storageLimit).toBe(1024 * 1024);
    expect(me.storageUsed).toBe(0);
    await c.post('/api/notes', {});
    expect((await c.get('/api/me')).json().storageUsed).toBeGreaterThan(0);
  });
});
