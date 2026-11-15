// Acceptance criterion 3: every supported element survives save, reload and search.
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client as McpClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { makeEnv, userClient, upload, type Client, type Env } from './helpers.js';
import { fullDoc, FULL_MARKDOWN } from './fixtures/full-note.js';

let env: Env;
let alice: Client;
beforeEach(async () => {
  env = await makeEnv();
  alice = await userClient(env, 'alice');
});
afterEach(async () => env.close());

function types(node: any, out = new Set<string>()) {
  out.add(node.type);
  for (const m of node.marks ?? []) out.add('mark:' + m.type);
  for (const c of node.content ?? []) types(c, out);
  return out;
}

const ALL = ['doc', 'paragraph', 'text', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'codeBlock', 'horizontalRule', 'hardBreak', 'table', 'tableRow', 'tableHeader', 'tableCell', 'image', 'mark:bold', 'mark:italic', 'mark:strike', 'mark:code', 'mark:link'];

describe('round trip', () => {
  it('a browser note with every element, including a table and an image, survives save, reload and search', async () => {
    const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#fff' } }).png().toBuffer();
    const { src } = (await upload(alice, 'p.png', 'image/png', png)).json();
    const body = fullDoc(src);
    expect([...types(body)].sort()).toEqual([...ALL].sort());
    const n = (await alice.post('/api/notes', {})).json();
    const save = await alice.put(`/api/notes/${n.id}`, { title: 'Everything xray', body, version: 1 });
    expect(save.statusCode, save.body).toBe(200);
    const loaded = (await alice.get(`/api/notes/${n.id}`)).json();
    expect([...types(loaded.body)].sort()).toEqual([...ALL].sort());
    // Saving what was loaded changes nothing (stable after reload).
    const again = await alice.put(`/api/notes/${n.id}`, { title: loaded.title, body: loaded.body, version: loaded.version });
    expect(again.statusCode).toBe(200);
    const reloaded = (await alice.get(`/api/notes/${n.id}`)).json();
    expect(reloaded.body).toEqual(loaded.body);
    expect(JSON.stringify(reloaded.body)).toContain(src);
    expect((await alice.get(src)).statusCode).toBe(200);
    for (const word of ['xray', 'alpha', 'charlie', 'echo', 'golf', 'hotel', 'india', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'uniform']) {
      const ids = (await alice.post('/api/search', { query: word })).json().results.map((r: any) => r.id);
      expect(ids, word).toEqual([n.id]);
    }
  });

  it('an agent note with every Markdown element survives save, reload and search', async () => {
    await env.app.listen({ host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${(env.app.server.address() as { port: number }).port}`;
    const token = env.store.addAgent('alice', 'bot').token;
    const mcp = new McpClient({ name: 't', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const r = await mcp.callTool({ name: 'create_note', arguments: { title: 'Agent everything yankee', content: FULL_MARKDOWN, tags: ['zulu'] } });
    expect(r.isError).toBeFalsy();
    const id = /Created note ([0-9a-f-]{36})/.exec((r.content as any)[0].text)![1];
    const loaded = (await alice.get(`/api/notes/${id}`)).json();
    const expected = ALL.filter((t) => t !== 'image'); // images become their alt text
    expect([...types(loaded.body)].sort()).toEqual([...expected].sort());
    const text = JSON.stringify(loaded.body);
    expect(text).toContain('tango picture');
    expect(text).toContain('<span>raw whiskey</span>');
    expect(loaded.body.content[3]).toMatchObject({ type: 'heading', attrs: { level: 3 } }); // level 4 → 3
    const again = await alice.put(`/api/notes/${id}`, { title: loaded.title, body: loaded.body, version: 1 });
    expect(again.statusCode).toBe(200);
    expect((await alice.get(`/api/notes/${id}`)).json().body).toEqual(loaded.body);
    for (const word of ['yankee', 'zulu', 'alpha', 'victor', 'echo', 'golf', 'hotel', 'india', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'whiskey', 'uniform']) {
      const ids = (await alice.post('/api/search', { query: word })).json().results.map((x: any) => x.id);
      expect(ids, word).toEqual([id]);
    }
  });
});
