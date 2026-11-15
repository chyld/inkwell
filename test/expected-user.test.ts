// Round 3: a tab bound to one user cannot act on another user's account through the shared cookie.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, userClient, doc, p, type Client, type Env } from './helpers.js';

let env: Env;
let bob: Client;
let aliceId: string;
beforeEach(async () => {
  env = await makeEnv();
  aliceId = (await (await userClient(env, 'alice')).get('/api/me')).json().id;
  bob = await userClient(env, 'bob');
});
afterEach(async () => env.close());

describe('expected user header', () => {
  it('a request that expects another user is refused with 401 and changes nothing', async () => {
    const n = (await bob.post('/api/notes', {})).json();
    await bob.put(`/api/notes/${n.id}`, { title: 'bob', body: doc(p('bob')), version: 1 });
    await bob.post(`/api/notes/${n.id}/trash`);
    const stale = { 'x-notes-user': aliceId }; // Alice's old tab, now holding Bob's cookie
    for (const [m, u, b] of [
      ['GET', '/api/notes', undefined],
      ['POST', '/api/notes', {}],
      ['DELETE', '/api/trash', undefined],
      ['POST', '/api/folders', { name: 'x' }],
      ['GET', '/api/me', undefined],
    ] as const) {
      const r = await bob.req(m, u, b, stale);
      expect(r.statusCode, `${m} ${u}`).toBe(401);
      expect(r.json().error.code).toBe('wrong_user');
    }
    expect((await bob.get('/api/notes?view=trash')).json().notes).toHaveLength(1);
    expect((await bob.get('/api/notes')).json().notes).toHaveLength(0);
    // Sign-out from the stale tab does not end Bob's session either.
    expect((await bob.req('DELETE', '/api/session', undefined, stale)).statusCode).toBe(401);
    expect((await bob.get('/api/me')).statusCode).toBe(200);
  });

  it('the right user id, or none, is accepted', async () => {
    const bobId = (await bob.get('/api/me')).json().id;
    expect((await bob.req('GET', '/api/notes', undefined, { 'x-notes-user': bobId })).statusCode).toBe(200);
    expect((await bob.req('POST', '/api/notes', {}, { 'x-notes-user': bobId })).statusCode).toBe(201);
    expect((await bob.get('/api/notes')).statusCode).toBe(200);
  });
});
