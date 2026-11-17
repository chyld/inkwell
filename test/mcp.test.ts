// Acceptance criteria 4, 5 and 8 (and the agent half of 3 and 14).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client as McpClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { makeEnv, userClient, doc, p, type Client, type Env } from './helpers.js';
import { HOUR, Store } from '../src/server/store.js';
import { validateBody } from '../src/shared/schema.js';
import * as z from 'zod';

let env: Env;
let base: string;
let alice: Client;
let token: string;

async function setup(overrides: Record<string, string> = {}) {
  env = await makeEnv(overrides);
  await env.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = env.app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  alice = await userClient(env, 'alice');
  token = env.store.identity.addAgent('alice', 'Claude Code').token;
}
afterEach(async () => env.close());

/** Content types of every /mcp response the SDK client received. */
const seenTypes: string[] = [];
const recordingFetch = async (url: string | URL, init?: RequestInit) => {
  const r = await fetch(url, init);
  seenTypes.push(`${init?.method ?? 'GET'} ${r.status} ${r.headers.get('content-type') ?? '-'}`);
  return r;
};

async function connect(tok = token, mode: 'legacy' | 'auto' = 'legacy') {
  const client = new McpClient({ name: 'test', version: '1.0.0' }, mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {});
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tok}` } },
    fetch: recordingFetch as any,
  });
  await client.connect(transport);
  return client;
}

async function rawMcp(body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  return fetch(`${base}/mcp`, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

const textOf = (r: any) => r.content.map((c: any) => c.text).join('');

describe('MCP endpoint with the SDK client', () => {
  beforeEach(() => setup());

  for (const mode of ['legacy', 'auto'] as const) {
    it(`handshake, tools/list and create_note work (${mode} negotiation)`, async () => {
      seenTypes.length = 0;
      const client = await connect(token, mode);
      const caps = client.getServerCapabilities()!;
      expect(Object.keys(caps)).toEqual(['tools']);
      expect(caps.tools!.listChanged).toBeFalsy();
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(['create_note']);
      // The app's name as agents see it.
      expect(client.getServerVersion()?.name).toBe('inkwell');
      expect(tools.tools[0].description).toMatch(/^Create a new note in the user’s Inkwell app\./);
      if (mode === 'legacy') {
        await client.ping();
        expect(client.getNegotiatedProtocolVersion()).toMatch(/^2025-/);
      } else expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
      const r = await client.callTool({ name: 'create_note', arguments: { title: `From ${mode}`, content: 'Hello **world**', tags: ['AI', 'inbox'] } });
      expect(r.isError).toBeFalsy();
      const id = /Created note ([0-9a-f-]{36}) in the Inbox\./.exec(textOf(r))![1];
      expect(r.content).toHaveLength(1);
      const inbox = (await alice.get('/api/notes?view=inbox')).json().notes;
      expect(inbox.map((n: any) => n.id)).toEqual([id]);
      expect(inbox[0].origin).toEqual({ type: 'agent', name: 'Claude Code' });
      const note = (await alice.get(`/api/notes/${id}`)).json();
      expect(note.version).toBe(1);
      expect(note.tags).toEqual(['ai', 'inbox']);
      expect(note.body.content[0].content[1]).toMatchObject({ text: 'world', marks: [{ type: 'bold' }] });
      expect((await alice.post('/api/search', { query: 'world' })).json().results.map((n: any) => n.id)).toEqual([id]);
      await client.close();
      // JSON responses only: no SSE stream, and no MCP session id.
      expect(seenTypes.length).toBeGreaterThan(2);
      for (const t of seenTypes) expect(t).toMatch(/^(POST 200 application\/json|POST 202 -|GET 405 |DELETE 405 )/);
      expect(seenTypes.filter((t) => t.startsWith('POST')).length).toBeGreaterThan(2);
    });
  }

  it('any other tool or method fails with the standard error', async () => {
    const client = await connect();
    await expect(client.callTool({ name: 'delete_note', arguments: {} })).rejects.toThrow();
    // Through the SDK client's own request path:
    for (const method of ['resources/list', 'prompts/list', 'logging/setLevel']) {
      await expect(client.request({ method, params: {} } as any, z.object({}).passthrough()), method).rejects.toThrow(/not found|-32601/i);
    }
    for (const method of ['resources/list', 'resources/read', 'prompts/list', 'prompts/get', 'logging/setLevel', 'completion/complete', 'sampling/createMessage', 'tasks/list', 'subscriptions/listen', 'notes/read']) {
      const r = await rawMcp({ jsonrpc: '2.0', id: 7, method, params: {} });
      const j = await r.json();
      expect(j.error?.code, method).toBe(-32601);
    }
    const unknownTool = await (await rawMcp({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'list_notes', arguments: {} } })).json();
    expect(unknownTool.error.code).toBe(-32602);
    expect((await alice.get('/api/notes')).json().notes).toHaveLength(0);
  });

  it('the agent token is refused by /api', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(401);
    const w = await env.app.inject({ method: 'POST', url: '/api/notes', headers: { authorization: `Bearer ${token}`, origin: 'https://notes.test' }, payload: {} });
    expect(w.statusCode).toBe(401);
  });

  it('a session cookie is refused by /mcp', async () => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', cookie: alice.cookie },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/^Bearer/);
  });

  it('missing or unknown tokens get 401; a page Origin gets 403; other methods 405; no CORS headers', async () => {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    expect((await rawMcp(list, { authorization: '' })).status).toBe(401);
    expect((await rawMcp(list, { authorization: 'Bearer nta_wrong' })).status).toBe(401);
    expect((await rawMcp(list, { authorization: `Basic ${token}` })).status).toBe(401);
    const withOrigin = await rawMcp(list, { origin: 'https://notes.test' });
    expect(withOrigin.status).toBe(403);
    for (const m of ['GET', 'DELETE', 'PUT', 'PATCH']) expect((await rawMcp(null, {}, m)).status, m).toBe(405);
    const pre = await fetch(`${base}/mcp`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(pre.status).toBe(403);
    for (const r of [withOrigin, pre, await rawMcp(list)]) {
      for (const k of r.headers.keys()) expect(k.startsWith('access-control-')).toBe(false);
    }
  });

  it('limits the request body to 1 MB', async () => {
    const big = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_note', arguments: { title: 'x', content: 'a'.repeat(1024 * 1024) } } };
    expect((await rawMcp(big)).status).toBe(413);
    expect((await alice.get('/api/notes')).json().notes).toHaveLength(0);
  });

  it('answers initialize and tools/call with a single JSON body and no session id', async () => {
    const init = await rawMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } });
    expect(init.status).toBe(200);
    expect(init.headers.get('content-type')).toMatch(/^application\/json/);
    expect(init.headers.get('mcp-session-id')).toBe(null);
    expect((await init.json()).result.capabilities).toEqual({ tools: { listChanged: false } });
    const note = await rawMcp(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_note', arguments: { title: 'raw', content: 'x' } } },
      { 'mcp-protocol-version': '2025-06-18' },
    );
    expect(note.headers.get('content-type')).toMatch(/^application\/json/);
    expect((await note.json()).result.content[0].text).toMatch(/^Created note [0-9a-f-]{36} in the Inbox\.$/);
    const notif = await rawMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-protocol-version': '2025-06-18' });
    expect(notif.status).toBe(202);
  });

  it('answers malformed JSON with a JSON-RPC parse error', async () => {
    const r = await rawMcp('{not json');
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe(-32700);
  });

  it('the agent cannot choose the folder or set any other field', async () => {
    const client = await connect();
    const f = (await alice.post('/api/folders', { name: 'Elsewhere' })).json().id;
    const r = await client.callTool({ name: 'create_note', arguments: { title: 't', content: 'c', folderId: f, folder: f, version: 9 } as any });
    const id = /Created note ([0-9a-f-]{36})/.exec(textOf(r))![1];
    const note = (await alice.get(`/api/notes/${id}`)).json();
    expect(note.folderId).toBe((await alice.get('/api/me')).json().inboxId);
    expect(note.version).toBe(1);
  });

  it('rejects fields that break the rules and creates nothing', async () => {
    const client = await connect();
    const bad = [
      { title: '', content: 'x' },
      { title: 'x'.repeat(201), content: 'x' },
      { title: 'ok', content: 'é'.repeat(50_001) },
      { title: 'ok', content: 'x', tags: ['a,b'] },
      { title: 'ok', content: 'x', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      { title: 'ok' },
    ];
    for (const args of bad) {
      let failed = false;
      try {
        const r = await client.callTool({ name: 'create_note', arguments: args as any });
        failed = !!r.isError;
      } catch {
        failed = true;
      }
      expect(failed, JSON.stringify(args).slice(0, 80)).toBe(true);
    }
    expect((await alice.get('/api/notes')).json().notes).toHaveLength(0);
    const ok = await client.callTool({ name: 'create_note', arguments: { title: 'x'.repeat(200), content: 'é'.repeat(50_000), tags: Array.from({ length: 10 }, (_, i) => `t${i}`) } });
    expect(ok.isError).toBeFalsy();
  });
});

describe('revoked tokens and disabled users (criterion 5)', () => {
  beforeEach(() => setup());

  it('a revoked token gets 401', async () => {
    const client = await connect();
    await client.listTools();
    env.store.identity.revokeAgent('alice', 'Claude Code');
    const r = await rawMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(r.status).toBe(401);
    await expect(connect()).rejects.toThrow();
  });

  it('a disabled user’s token gets 401, and works again once enabled', async () => {
    env.store.identity.setDisabled('alice', true);
    expect((await rawMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).status).toBe(401);
    env.store.identity.setDisabled('alice', false);
    expect((await rawMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).status).toBe(200);
  });

  it('other agents keep working after one is revoked', async () => {
    const other = env.store.identity.addAgent('alice', 'Codex').token;
    env.store.identity.revokeAgent('alice', 'Claude Code');
    const client = await connect(other);
    const r = await client.callTool({ name: 'create_note', arguments: { title: 't', content: 'c' } });
    expect(r.isError).toBeFalsy();
    expect((await alice.get('/api/notes?view=inbox')).json().notes[0].origin.name).toBe('Codex');
  });
});

describe('agent Markdown is made safe (criterion 8)', () => {
  beforeEach(() => setup());

  it('raw HTML, javascript: links and images are not active', async () => {
    const client = await connect();
    const content = [
      '<script>alert(1)</script>',
      '',
      'Inline <img src=x onerror=alert(1)> html and <a href="javascript:alert(2)">a</a>.',
      '',
      '[click me](javascript:alert(3)) and [data](data:text/html,hi) and [ok](https://example.com)',
      '',
      '![a cat](https://evil.example/cat.png) ![](https://evil.example/none.png)',
      '',
      '<iframe src="https://evil.example"></iframe>',
    ].join('\n');
    const r = await client.callTool({ name: 'create_note', arguments: { title: 'evil', content } });
    const id = /Created note ([0-9a-f-]{36})/.exec(textOf(r))![1];
    const note = (await alice.get(`/api/notes/${id}`)).json();
    const json = JSON.stringify(note.body);
    const nodes: any[] = [];
    const walk = (n: any) => {
      nodes.push(n);
      (n.content ?? []).forEach(walk);
    };
    walk(note.body);
    expect(nodes.some((n) => n.type === 'image')).toBe(false);
    const hrefs = nodes.flatMap((n) => (n.marks ?? []).filter((m: any) => m.type === 'link').map((m: any) => m.attrs.href));
    expect(hrefs).toEqual(['https://example.com']);
    // Raw HTML survives only as literal text.
    expect(nodes.filter((n) => n.type === 'text').map((n) => n.text).join('')).toContain('<script>alert(1)</script>');
    expect(json).toContain('a cat');
    expect(nodes.every((n) => ['doc', 'paragraph', 'text'].includes(n.type))).toBe(true);
  });
});

describe('agent limits (criteria 8 and 14)', () => {
  it('an over-rate call creates nothing; the count survives a restart and frees up after an hour', async () => {
    await setup({ NOTES_AGENT_RATE_PER_HOUR: '3' });
    const client = await connect();
    for (let i = 0; i < 3; i++) {
      const r = await client.callTool({ name: 'create_note', arguments: { title: `n${i}`, content: 'x' } });
      expect(r.isError).toBeFalsy();
      env.clock.t += 60_000;
    }
    const over = await client.callTool({ name: 'create_note', arguments: { title: 'over', content: 'x' } });
    expect(over.isError).toBe(true);
    expect(textOf(over)).toMatch(/rate limit/i);
    expect((await alice.get('/api/notes')).json().notes).toHaveLength(3);
    // Counted in the database: a fresh Store (as after a restart) sees the same count.
    const again = new Store(env.store.db, { ...env.store.opts, now: () => env.clock.t });
    const agent = again.identity.authenticateAgent(token)!;
    expect(() => again.notes.createAgentNote(agent, { title: 'x', body: validateBody(doc(p('x'))), tags: [] })).toThrow(/rate limit/i);
    // Rejected calls do not count; an hour after the first call there is room again.
    env.clock.t += HOUR - 2 * 60_000;
    const later = await client.callTool({ name: 'create_note', arguments: { title: 'later', content: 'x' } });
    expect(later.isError).toBeFalsy();
  });

  it('an over-size converted body creates nothing', async () => {
    await setup();
    const client = await connect();
    const content = '*a* '.repeat(24_000); // under 100,000 bytes of Markdown, over 1 MB once converted
    expect(Buffer.byteLength(content)).toBeLessThan(100_000);
    const r = await client.callTool({ name: 'create_note', arguments: { title: 'big', content } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/1 MB/);
    expect((await alice.get('/api/notes')).json().notes).toHaveLength(0);
    expect(env.store.db.prepare('SELECT count(*) c FROM agent_calls').get()).toEqual({ c: 0 });
  });

  it('an over-quota call creates nothing', async () => {
    await setup({ NOTES_USER_QUOTA_MB: '1' });
    const client = await connect();
    // Fill most of the 1 MB quota with one note.
    const n = (await alice.post('/api/notes', {})).json();
    const fill = await alice.put(`/api/notes/${n.id}`, { title: 'fill', body: doc(p('x'.repeat(1024 * 1024 - 100))), version: 1 });
    expect(fill.statusCode).toBe(200);
    const before = (await alice.get('/api/me')).json().storageUsed;
    const r = await client.callTool({ name: 'create_note', arguments: { title: 'over', content: 'some words that do not fit', tags: ['newtag'] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/storage limit/i);
    expect((await alice.get('/api/notes')).json().notes).toHaveLength(1);
    expect((await alice.get('/api/me')).json().storageUsed).toBe(before);
    expect(env.store.db.prepare('SELECT count(*) c FROM tags').get()).toEqual({ c: 0 });
    expect(env.store.db.prepare('SELECT count(*) c FROM notes_fts').get()).toEqual({ c: 1 });
  });
});
