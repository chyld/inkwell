// Acceptance criterion 6.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, userClient, doc, p, type Client, type Env } from './helpers.js';
import { buildFtsQuery } from '../src/server/store.js';

let env: Env;
let alice: Client;
let bob: Client;
beforeEach(async () => {
  env = await makeEnv();
  alice = await userClient(env, 'alice');
  bob = await userClient(env, 'bob');
});
afterEach(async () => env.close());

async function note(c: Client, title: string, text: string, tags: string[] = [], folderId: string | null = null) {
  const n = (await c.post('/api/notes', { folderId })).json();
  expect((await c.put(`/api/notes/${n.id}`, { title, body: doc(p(text)), version: 1 })).statusCode).toBe(200);
  if (tags.length) await c.patch(`/api/notes/${n.id}`, { tags });
  return n.id as string;
}
const search = async (c: Client, query: unknown, extra: Record<string, unknown> = {}) => {
  const r = await c.post('/api/search', { query, ...extra });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().results as any[];
};

describe('search', () => {
  it('finds a note by a word in its title, body and tag', async () => {
    const id = await note(alice, 'Quarterly planning', 'The budget for marzipan is approved', ['finance']);
    expect((await search(alice, 'quarterly')).map((r) => r.id)).toEqual([id]);
    expect((await search(alice, 'marzipan')).map((r) => r.id)).toEqual([id]);
    expect((await search(alice, 'finance')).map((r) => r.id)).toEqual([id]);
    // Prefix on the last word (results as you type), several words ANDed.
    expect((await search(alice, 'budget marzi')).map((r) => r.id)).toEqual([id]);
    expect(await search(alice, 'budget nothinghere')).toEqual([]);
    // Diacritics removed.
    const cafe = await note(alice, 'Café', 'crème brûlée');
    expect((await search(alice, 'creme')).map((r) => r.id)).toEqual([cafe]);
  });

  it('returns a plain-text snippet and never HTML', async () => {
    await note(alice, 'html', 'Text with <b>angle</b> brackets and & ampersand');
    const [r] = await search(alice, 'angle');
    expect(r.snippet).toContain('<b>angle</b>');
    expect(typeof r.snippet).toBe('string');
  });

  it('ranks a title match above a body match', async () => {
    const body = await note(alice, 'Something', 'pelican pelican mentioned here');
    const title = await note(alice, 'Pelican facts', 'birds');
    expect((await search(alice, 'pelican')).map((r) => r.id)).toEqual([title, body]);
  });

  it('never returns a trashed note or another user’s note', async () => {
    const mine = await note(alice, 'shared word', 'xylophone');
    const trashed = await note(alice, 'gone', 'xylophone');
    await alice.post(`/api/notes/${trashed}/trash`);
    const bobs = await note(bob, 'bob', 'xylophone', ['xylophone']);
    expect((await search(alice, 'xylophone')).map((r) => r.id)).toEqual([mine]);
    expect((await search(bob, 'xylophone')).map((r) => r.id)).toEqual([bobs]);
  });

  it('does not error on hostile input', async () => {
    await note(alice, 'C++ notes', 'a:b and more');
    for (const q of ['C++', '"', '(', ')', 'a:b', '*', 'AND', 'OR', 'NOT', 'NEAR(a b)', '^x', '-x', '', '   ', '""""', "'", '\\', 'title:x', '{x}', '[x]']) {
      const r = await alice.post('/api/search', { query: q });
      expect(r.statusCode, `query ${JSON.stringify(q)}`).toBe(200);
    }
    expect(await search(alice, '')).toEqual([]);
    expect((await search(alice, 'C++')).length).toBe(1);
    expect((await search(alice, 'a:b')).length).toBe(1);
    // Non-string input is treated as no query.
    expect(await search(alice, 42)).toEqual([]);
  });

  it('builds the MATCH expression as the spec says', () => {
    expect(buildFtsQuery('a "b c')).toBe('"a" """b" "c"*');
    expect(buildFtsQuery('  ')).toBe(null);
  });

  it('can be narrowed to a folder (with subfolders) or a tag', async () => {
    const top = (await alice.post('/api/folders', { name: 'Top' })).json().id;
    const sub = (await alice.post('/api/folders', { name: 'Sub', parentId: top })).json().id;
    const a = await note(alice, 'walrus one', 'x', ['blue'], top);
    const b = await note(alice, 'walrus two', 'x', [], sub);
    const c = await note(alice, 'walrus three', 'x', ['blue'], null);
    expect((await search(alice, 'walrus', { folderId: top })).map((r) => r.id).sort()).toEqual([a, b].sort());
    expect((await search(alice, 'walrus', { folderId: sub })).map((r) => r.id)).toEqual([b]);
    expect((await search(alice, 'walrus', { tag: 'blue' })).map((r) => r.id).sort()).toEqual([a, c].sort());
    // Another user's folder id behaves like one that does not exist.
    expect((await bob.post('/api/search', { query: 'walrus', folderId: top })).statusCode).toBe(404);
  });

  it('limits results to 50', async () => {
    for (let i = 0; i < 55; i++) await note(alice, `kiwi ${i}`, 'fruit');
    expect(await search(alice, 'kiwi')).toHaveLength(50);
  });

  it('keeps the index in step with title, body, tag and Trash changes', async () => {
    const id = await note(alice, 'alpha', 'beta', ['gamma']);
    const n = (await alice.get(`/api/notes/${id}`)).json();
    await alice.put(`/api/notes/${id}`, { title: 'delta', body: doc(p('epsilon')), version: n.version });
    await alice.patch(`/api/notes/${id}`, { tags: ['zeta'] });
    expect(await search(alice, 'alpha')).toHaveLength(0);
    expect(await search(alice, 'beta')).toHaveLength(0);
    expect(await search(alice, 'gamma')).toHaveLength(0);
    for (const w of ['delta', 'epsilon', 'zeta']) expect(await search(alice, w)).toHaveLength(1);
  });
});
