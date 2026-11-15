// Acceptance criterion 11 (and session basics from SPEC 5).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, makeEnv, userClient, PASSWORD, type Env } from './helpers.js';
import { DAY, HOUR } from '../src/server/store.js';

let env: Env;
beforeEach(async () => (env = await makeEnv()));
afterEach(async () => env.close());

describe('sessions', () => {
  it('sets a secure session cookie with the right attributes', async () => {
    await env.store.createUser('alice', PASSWORD);
    const c = new Client(env);
    const r = await c.signIn('ALICE');
    expect(r.statusCode).toBe(200);
    const sc = String(r.headers['set-cookie']);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Path=\//);
    expect(sc).toMatch(/Max-Age=7776000/);
    expect((await c.get('/api/me')).json().username).toBe('alice');
  });

  it('stores only the SHA-256 hash of the session id', async () => {
    const c = await userClient(env, 'alice');
    const token = c.cookie.split('=')[1];
    const rows = env.store.db.prepare('SELECT id_hash FROM sessions').all() as { id_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id_hash).not.toContain(token);
    expect(rows[0].id_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores an existing session id on sign-in and issues a new one', async () => {
    const c = await userClient(env, 'alice');
    const first = c.cookie;
    await c.signIn('alice');
    expect(c.cookie).not.toBe(first);
  });

  it('is refused after 30 idle days', async () => {
    const c = await userClient(env, 'alice');
    env.clock.t += 29 * DAY;
    expect((await c.get('/api/me')).statusCode).toBe(200);
    env.clock.t += 29 * DAY; // used 29 days ago: still fine
    expect((await c.get('/api/me')).statusCode).toBe(200);
    env.clock.t += 30 * DAY + HOUR;
    expect((await c.get('/api/me')).statusCode).toBe(401);
    expect(env.store.db.prepare('SELECT count(*) c FROM sessions').get()).toEqual({ c: 0 });
  });

  it('is refused after 90 days even when used every day', async () => {
    const c = await userClient(env, 'alice');
    for (let d = 0; d < 89; d++) {
      env.clock.t += DAY;
      expect((await c.get('/api/me')).statusCode).toBe(200);
    }
    env.clock.t += DAY + HOUR;
    expect((await c.get('/api/me')).statusCode).toBe(401);
  });

  it('refreshes last_used at most once an hour', async () => {
    const c = await userClient(env, 'alice');
    const lu = () => (env.store.db.prepare('SELECT last_used FROM sessions').get() as { last_used: number }).last_used;
    const start = lu();
    env.clock.t += 30 * 60 * 1000;
    await c.get('/api/me');
    expect(lu()).toBe(start);
    env.clock.t += 31 * 60 * 1000;
    await c.get('/api/me');
    expect(lu()).toBe(env.clock.t);
  });

  it('is refused after sign-out', async () => {
    const c = await userClient(env, 'alice');
    const saved = c.cookie;
    expect((await c.del('/api/session')).statusCode).toBe(200);
    c.cookie = saved;
    expect((await c.get('/api/me')).statusCode).toBe(401);
  });

  it('is refused after a password change, for every session of that user', async () => {
    const a = await userClient(env, 'alice');
    const b = await userClient(env, 'alice');
    const other = await userClient(env, 'bob');
    await env.store.setPassword('alice', 'another long password');
    expect((await a.get('/api/me')).statusCode).toBe(401);
    expect((await b.get('/api/me')).statusCode).toBe(401);
    expect((await other.get('/api/me')).statusCode).toBe(200);
    expect((await new Client(env).signIn('alice', 'another long password')).statusCode).toBe(200);
  });

  it('is refused after the user is disabled, and sign-in is blocked until enabled', async () => {
    const a = await userClient(env, 'alice');
    env.store.setDisabled('alice', true);
    expect((await a.get('/api/me')).statusCode).toBe(401);
    expect((await new Client(env).signIn('alice')).statusCode).toBe(401);
    env.store.setDisabled('alice', false);
    expect((await new Client(env).signIn('alice')).statusCode).toBe(200);
  });

  it('removes expired rows at start-up', async () => {
    await userClient(env, 'alice');
    env.clock.t += 31 * DAY;
    expect(env.store.purgeExpiredSessions()).toBe(1);
  });

  it('returns one generic message for wrong password and unknown user', async () => {
    await env.store.createUser('alice', PASSWORD);
    const a = await new Client(env).signIn('alice', 'wrong password!!');
    const b = await new Client(env).signIn('nobody', 'wrong password!!');
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });

  it('requires a session for every /api route except sign-in', async () => {
    const c = new Client(env);
    for (const [m, u] of [
      ['GET', '/api/me'],
      ['GET', '/api/notes'],
      ['POST', '/api/notes'],
      ['GET', '/api/folders'],
      ['GET', '/api/tags'],
      ['POST', '/api/search'],
      ['DELETE', '/api/trash'],
    ]) {
      expect((await c.req(m, u, m === 'GET' ? undefined : {})).statusCode, `${m} ${u}`).toBe(401);
    }
  });
});
