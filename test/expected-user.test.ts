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

  // Round 3 follow-up: a request without the header used to be accepted; now it is refused,
  // so omitting the header can never act on whoever holds the cookie.
  it('the right user id is accepted; a request that does not say which user it is for is refused', async () => {
    const bobId = (await bob.get('/api/me')).json().id;
    expect((await bob.req('GET', '/api/notes', undefined, { 'x-notes-user': bobId })).statusCode).toBe(200);
    expect((await bob.req('POST', '/api/notes', {}, { 'x-notes-user': bobId })).statusCode).toBe(201);
    const before = (await bob.get('/api/notes')).json().notes.length;
    for (const [m, u, b] of [
      ['GET', '/api/me', undefined],
      ['GET', '/api/notes', undefined],
      ['POST', '/api/notes', {}],
      ['POST', '/api/search', { query: 'x' }],
      ['DELETE', '/api/trash', undefined],
      ['DELETE', '/api/session', undefined],
    ] as const) {
      const r = await bob.req(m, u, b, { 'x-notes-user': '' });
      expect(r.statusCode, `${m} ${u}`).toBe(401);
      expect(r.json().error.code).toBe('wrong_user');
    }
    expect((await bob.get('/api/notes')).json().notes.length).toBe(before);
    expect((await bob.get('/api/me')).statusCode).toBe(200);
  });

  it('GET /api/session (part of signing in) tells a new tab whose session the cookie holds, and nothing more', async () => {
    const bobId = (await bob.get('/api/me')).json().id;
    const r = await bob.req('GET', '/api/session', undefined, { 'x-notes-user': '' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: bobId, username: 'bob' });
    expect((await env.app.inject({ method: 'GET', url: '/api/session' })).statusCode).toBe(401);
  });

  it('every authenticated route of SPEC 4.1 refuses a request without the header, except GET /session and reading an image', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const routes: [string, string, unknown][] = [
      ['GET', '/api/me', undefined], ['GET', '/api/notes', undefined], ['POST', '/api/notes', {}], ['GET', `/api/notes/${id}`, undefined],
      ['PUT', `/api/notes/${id}`, {}], ['PATCH', `/api/notes/${id}`, {}], ['POST', `/api/notes/${id}/trash`, {}], ['POST', `/api/notes/${id}/restore`, {}],
      ['DELETE', `/api/notes/${id}`, undefined], ['DELETE', '/api/trash', undefined], ['GET', '/api/folders', undefined], ['POST', '/api/folders', {}],
      ['PATCH', `/api/folders/${id}`, {}], ['DELETE', `/api/folders/${id}`, undefined], ['GET', '/api/tags', undefined], ['POST', '/api/search', {}],
      ['POST', '/api/images', {}], ['DELETE', '/api/session', undefined],
    ];
    for (const [m, u, b] of routes) {
      const r = await bob.req(m, u, b, { 'x-notes-user': '' });
      expect(r.statusCode, `${m} ${u}`).toBe(401);
      expect(r.json().error.code, `${m} ${u}`).toBe('wrong_user');
    }
  });
});

