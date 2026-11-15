// Acceptance criterion 12.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, userClient, type Env } from './helpers.js';

let env: Env;
beforeEach(async () => (env = await makeEnv()));
afterEach(async () => env.close());

describe('Origin check on state-changing requests', () => {
  it('rejects missing or foreign Origin and accepts the configured one', async () => {
    const c = await userClient(env, 'alice');
    const cases: [string, string, unknown][] = [
      ['POST', '/api/notes', {}],
      ['POST', '/api/folders', { name: 'x' }],
      ['DELETE', '/api/trash', undefined],
      ['POST', '/api/search', { query: 'x' }],
      ['DELETE', '/api/session', undefined],
    ];
    for (const [m, u, b] of cases) {
      for (const origin of ['', 'https://evil.example', 'http://notes.test', 'https://notes.test:8443', 'null']) {
        const r = await c.req(m, u, b, { origin });
        expect(r.statusCode, `${m} ${u} origin=${origin}`).toBe(403);
      }
    }
    // Host header is never used to derive the expected origin.
    const spoof = await c.req('POST', '/api/notes', {}, { origin: 'https://evil.example', host: 'evil.example' });
    expect(spoof.statusCode).toBe(403);
    expect((await c.post('/api/notes', {})).statusCode).toBe(201);
    // Sign-in is also state-changing.
    const r = await c.req('POST', '/api/session', { username: 'alice', password: 'x' }, { origin: '' });
    expect(r.statusCode).toBe(403);
  });

  it('nothing was changed by a rejected request', async () => {
    const c = await userClient(env, 'alice');
    await c.req('POST', '/api/notes', {}, { origin: 'https://evil.example' });
    expect((await c.get('/api/notes')).json().notes).toHaveLength(0);
  });
});
