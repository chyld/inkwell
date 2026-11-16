// Text colour and highlight marks (palette 'Jewel'): the note stores a colour NAME; the strict
// validator accepts only our names; colours never sit inside code; search, Markdown (agents) and
// the stored JSON are otherwise unaffected.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HIGHLIGHT_COLORS, TEXT_COLORS, validateBody } from '../src/shared/schema.js';
import { markdownToDoc } from '../src/server/markdown.js';
import { makeEnv, userClient, type Client, type Env } from './helpers.js';

const t = (text: string, marks: unknown[] = []) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const body = (...content: unknown[]) => ({ type: 'doc', content });
const tc = (color: unknown) => ({ type: 'textColor', attrs: { color } });
const hl = (color: unknown) => ({ type: 'highlight', attrs: { color } });

describe('schema: colour marks', () => {
  it('accepts every palette name, combined with each other and with bold, italic, strike and link', () => {
    for (const c of TEXT_COLORS) expect(() => validateBody(body(para(t('x', [tc(c)]))))).not.toThrow();
    for (const c of HIGHLIGHT_COLORS) expect(() => validateBody(body(para(t('x', [hl(c)]))))).not.toThrow();
    const v = validateBody(
      body(para(t('all of it', [{ type: 'bold' }, { type: 'italic' }, { type: 'strike' }, { type: 'link', attrs: { href: 'https://example.com' } }, tc('sapphire'), hl('topaz')]))),
    );
    // Stored as names, never as colour values.
    expect(v.serialized).toContain('"type":"textColor","attrs":{"color":"sapphire"}');
    expect(v.serialized).toContain('"type":"highlight","attrs":{"color":"topaz"}');
    expect(v.serialized).not.toMatch(/#[0-9a-f]{6}|rgb|style/i);
  });

  it('rejects anything else: other names, colour values, a name from the other palette, missing or extra attributes', () => {
    const bad = [
      [tc('red')],
      [tc('#9c012b')],
      [tc('rgb(1,2,3)')],
      [tc('Ruby')],
      [tc('topaz')], // a highlight name is not a text colour
      [hl('onyx')], // and the other way round
      [tc(null)],
      [tc(7)],
      [{ type: 'textColor' }],
      [{ type: 'highlight', attrs: {} }],
      [{ type: 'textColor', attrs: { color: 'ruby', style: 'color:red' } }],
      [{ type: 'highlight', attrs: { color: 'topaz', class: 'x' } }],
      [{ type: 'color', attrs: { color: 'ruby' } }],
      [tc('ruby'), tc('teal')], // two colours on the same text
    ];
    for (const marks of bad) expect(() => validateBody(body(para(t('x', marks)))), JSON.stringify(marks)).toThrow();
  });

  it('does not allow colours inside inline code or code blocks', () => {
    expect(() => validateBody(body(para(t('x', [{ type: 'code' }, tc('ruby')]))))).toThrow();
    expect(() => validateBody(body(para(t('x', [{ type: 'code' }, hl('topaz')]))))).toThrow();
    expect(() => validateBody(body({ type: 'codeBlock', content: [t('x', [tc('ruby')])] }))).toThrow();
    expect(() => validateBody(body({ type: 'codeBlock', content: [t('x', [hl('aqua')])] }))).toThrow();
  });

  it('leaves the searchable plain text unchanged', () => {
    const plain = validateBody(body(para(t('Red '), t('alert', [tc('ruby'), hl('coral')]), t(' here')))).text;
    expect(plain).toBe('Red alert here');
  });

  it('agents cannot set colours: Markdown has no syntax for them and raw HTML stays literal text', () => {
    const d = markdownToDoc('Hello <span data-text-color="ruby">red</span> and <mark data-highlight="topaz">marked</mark>') as any;
    const json = JSON.stringify(d);
    expect(json).not.toContain('"textColor"');
    expect(json).not.toContain('"highlight"');
    expect(json).toContain('data-text-color');
  });
});

describe('API: colour marks', () => {
  let env: Env;
  let alice: Client;
  beforeEach(async () => {
    env = await makeEnv();
    alice = await userClient(env, 'alice');
  });
  afterEach(async () => env.close());

  it('round-trips through save and reload, and the coloured words are searchable', async () => {
    const n = (await alice.post('/api/notes', { folderId: null })).json();
    const b = body(para(t('Plain '), t('emphasised', [{ type: 'bold' }, tc('emerald'), hl('peridot')]), t(' end')));
    const put = await alice.put(`/api/notes/${n.id}`, { title: 'Colours', body: b, version: 1 });
    expect(put.statusCode, put.body).toBe(200);
    const got = (await alice.get(`/api/notes/${n.id}`)).json();
    expect(got.body).toEqual(b);
    const found = (await alice.post('/api/search', { query: 'emphasised' })).json().results.map((r: any) => r.id);
    expect(found).toEqual([n.id]);
  });

  it('refuses a save with a colour that is not in the palette, and keeps the note as it was', async () => {
    const n = (await alice.post('/api/notes', { folderId: null })).json();
    const r = await alice.put(`/api/notes/${n.id}`, { title: 'x', body: body(para(t('x', [tc('#ff0000')]))), version: 1 });
    expect(r.statusCode).toBe(400);
    expect((await alice.get(`/api/notes/${n.id}`)).json().version).toBe(1);
  });
});
