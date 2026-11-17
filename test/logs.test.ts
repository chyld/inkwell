// Acceptance criterion 16: no token or session id appears in the logs.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client as McpClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { makeEnv, userClient, PASSWORD, Client, type Env } from './helpers.js';

let env: Env;
beforeEach(async () => (env = await makeEnv()));
afterEach(async () => env.close());

describe('logging', () => {
  it('never writes tokens, session ids, passwords, query strings or bodies', async () => {
    await env.app.listen({ host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${(env.app.server.address() as { port: number }).port}`;
    const alice = await userClient(env, 'alice');
    const sessionId = alice.cookie.split('=')[1];
    const token = env.store.identity.addAgent('alice', 'bot').token;
    const revoked = env.store.identity.addAgent('alice', 'old').token;
    env.store.identity.revokeAgent('alice', 'old');

    // Normal use, failures and errors.
    await alice.get('/api/notes?view=tag&tag=secretquerytag');
    await alice.post('/api/search', { query: 'secretsearchterm' });
    const n = (await alice.post('/api/notes', {})).json();
    await alice.put(`/api/notes/${n.id}`, { title: 'secret title words', body: { type: 'doc', content: [] }, version: 1 });
    await alice.put(`/api/notes/${n.id}`, { title: 'x', body: { type: 'bogus' }, version: 2 });
    await new Client(env).signIn('alice', 'wrong secret password');
    await env.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `notes_session=${sessionId}x` } });
    const mcp = new McpClient({ name: 't', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    await mcp.callTool({ name: 'create_note', arguments: { title: 'agent secret title', content: 'agent secret body' } });
    await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${revoked}`, 'content-type': 'application/json' }, body: '{}' });
    await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'https://x' }, body: '{}' });
    await alice.del('/api/session');

    const logs = env.logs();
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [sessionId, token, revoked, token.slice(4), PASSWORD, 'wrong secret password', 'secretquerytag', 'secretsearchterm', 'secret title words', 'agent secret', 'Bearer']) {
      expect(logs, secret).not.toContain(secret);
    }
    const lines = logs.trim().split('\n').map((l) => JSON.parse(l));
    const requests = lines.filter((l) => l.msg === 'request');
    expect(requests.length).toBeGreaterThan(10);
    for (const l of requests) {
      expect(Object.keys(l).sort()).toEqual(['hostname', 'level', 'method', 'ms', 'msg', 'path', 'pid', 'reqId', 'status', 'time'].sort());
      expect(l.path).not.toContain('?');
    }
    expect(requests.some((l) => l.path === '/mcp' && l.status === 200)).toBe(true);
    expect(requests.some((l) => l.path === '/api/notes' && l.method === 'GET')).toBe(true);
  });
});
