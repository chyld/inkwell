// Acceptance criterion 9.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, makeEnv, PASSWORD, type Env } from './helpers.js';

const PROXY = '172.30.87.2'; // Caddy's address on the Compose network (trusted)
let env: Env;
beforeEach(async () => {
  env = await makeEnv({ NOTES_TRUSTED_PROXY: '172.30.87.0/24' });
  await env.store.createUser('alice', PASSWORD);
});
afterEach(async () => env.close());

function viaProxy(clientIp: string) {
  const c = new Client(env, PROXY);
  return (username: string, password: string) => c.req('POST', '/api/session', { username, password }, { 'x-forwarded-for': clientIp });
}

describe('sign-in rate limits', () => {
  it('limits 5 failures per (username, client IP) and counts client addresses separately behind the proxy', async () => {
    const a = viaProxy('198.51.100.1');
    for (let i = 0; i < 5; i++) expect((await a('alice', 'wrong password!')).statusCode).toBe(401);
    expect((await a('alice', PASSWORD)).statusCode).toBe(429);
    // Username input is lower-cased before use, including the rate-limit key.
    expect((await a('ALICE', PASSWORD)).statusCode).toBe(429);
    // Another client address is not affected; nobody can lock alice out.
    const b = viaProxy('198.51.100.2');
    expect((await b('alice', PASSWORD)).statusCode).toBe(200);
    // Same address, other username: not blocked by the pair limit.
    await env.store.createUser('bob', PASSWORD);
    expect((await a('bob', PASSWORD)).statusCode).toBe(200);
  });

  it('limits 20 failures per client IP across usernames', async () => {
    const a = viaProxy('198.51.100.7');
    for (let i = 0; i < 20; i++) expect((await a(`user${i}`, 'wrong password!')).statusCode).toBe(401);
    expect((await a('alice', PASSWORD)).statusCode).toBe(429);
    expect((await viaProxy('198.51.100.8')('alice', PASSWORD)).statusCode).toBe(200);
  });

  it('the window is 15 minutes', async () => {
    const a = viaProxy('198.51.100.1');
    for (let i = 0; i < 5; i++) await a('alice', 'wrong password!');
    expect((await a('alice', PASSWORD)).statusCode).toBe(429);
    env.clock.t += 15 * 60 * 1000 + 1;
    expect((await a('alice', PASSWORD)).statusCode).toBe(200);
  });

  it('a forged X-Forwarded-For from outside the proxy subnet is ignored', async () => {
    const outsider = new Client(env, '203.0.113.9');
    for (let i = 0; i < 5; i++) {
      const forged = `198.51.100.${100 + i}`;
      const r = await outsider.req('POST', '/api/session', { username: 'alice', password: 'wrong password!' }, { 'x-forwarded-for': forged });
      expect(r.statusCode).toBe(401);
    }
    // All five were counted against the real address, whatever header was sent.
    const r = await outsider.req('POST', '/api/session', { username: 'alice', password: PASSWORD }, { 'x-forwarded-for': '198.51.100.250' });
    expect(r.statusCode).toBe(429);
  });

  it('through the proxy, only the address Caddy saw counts (client-supplied entries are overwritten by Caddy)', async () => {
    // Caddy sets X-Forwarded-For to exactly {remote_host}, so the app sees one address.
    // If a client-supplied value ever reached the app alongside it, the rightmost
    // (proxy-added) entry is the one used.
    const c = new Client(env, PROXY);
    for (let i = 0; i < 5; i++) {
      await c.req('POST', '/api/session', { username: 'alice', password: 'wrong password!' }, { 'x-forwarded-for': `10.0.0.${i}, 198.51.100.9` });
    }
    const r = await c.req('POST', '/api/session', { username: 'alice', password: PASSWORD }, { 'x-forwarded-for': '10.9.9.9, 198.51.100.9' });
    expect(r.statusCode).toBe(429);
  });

  it('counts attempts that are still in flight: concurrent guesses cannot get past the limits', async () => {
    const a = viaProxy('198.51.100.20');
    const results = await Promise.all(Array.from({ length: 30 }, () => a('alice', 'wrong password!')));
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(5);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(25);
    expect((await a('alice', PASSWORD)).statusCode).toBe(429);

    const b = viaProxy('198.51.100.21');
    const many = await Promise.all(Array.from({ length: 40 }, (_, i) => b(`nobody${i}`, 'wrong password!')));
    expect(many.filter((r) => r.statusCode === 401).length).toBeLessThanOrEqual(20);
    expect((await b('alice', PASSWORD)).statusCode).toBe(429);
  });

  it('a successful sign-in releases its reservation', async () => {
    const a = viaProxy('198.51.100.30');
    const ok = await Promise.all(Array.from({ length: 5 }, () => a('alice', PASSWORD)));
    expect(ok.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect((await a('alice', PASSWORD)).statusCode).toBe(200);
  });
});

