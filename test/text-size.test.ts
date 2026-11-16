// The fontSize mark (8-96 px) and underline, on the server: accepted as specified, every listed case
// refused; search ignores them; a save round-trips.
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, HEADING_SIZES, TEXT_SIZE_DEFAULT, defaultSizeOf, validateBody } from '../src/shared/schema.js';
import { makeEnv, userClient, type Client, type Env } from './helpers.js';

const t = (text: string, marks: unknown[] = []) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const body = (...content: unknown[]) => ({ type: 'doc', content });
const size = (s: unknown, extra: Record<string, unknown> = {}) => ({ type: 'fontSize', attrs: { size: s, ...extra } });

describe('schema: fontSize', () => {
  it('accepts every whole number from 8 to 96, combined with every other mark but code', () => {
    for (let s = FONT_SIZE_MIN; s <= FONT_SIZE_MAX; s++) expect(() => validateBody(body(para(t('x', [size(s)]))))).not.toThrow();
    const v = validateBody(
      body(para(t('all', [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }, { type: 'link', attrs: { href: 'https://example.com' } }, { type: 'textColor', attrs: { color: 'ruby' } }, { type: 'highlight', attrs: { color: 'topaz' } }, { type: 'fontFamily', attrs: { font: 'lora' } }, size(18)]))),
    );
    expect(v.serialized).toContain('{"type":"fontSize","attrs":{"size":18}}');
    expect(v.serialized).not.toMatch(/font-size|style|px/);
  });

  it('refuses a missing, non-integer or out-of-range size, another attribute, code, a code block and two sizes', () => {
    const cases: [string, unknown][] = [
      ['no attrs', body(para(t('x', [{ type: 'fontSize' }])))],
      ['missing size', body(para(t('x', [{ type: 'fontSize', attrs: {} }])))],
      ['null', body(para(t('x', [size(null)])))],
      ['7', body(para(t('x', [size(7)])))],
      ['97', body(para(t('x', [size(97)])))],
      ['0', body(para(t('x', [size(0)])))],
      ['-12', body(para(t('x', [size(-12)])))],
      ['16.5', body(para(t('x', [size(16.5)])))],
      ['a string', body(para(t('x', [size('16')])))],
      ['px', body(para(t('x', [size('16px')])))],
      ['NaN', body(para(t('x', [size(Number.NaN)])))],
      ['another attribute', body(para(t('x', [size(16, { style: 'font-size: 40px' })])))],
      ['with inline code', body(para(t('x', [{ type: 'code' }, size(18)])))],
      ['in a code block', body({ type: 'codeBlock', content: [t('x', [size(18)])] })],
      ['two sizes', body(para(t('x', [size(18), size(20)])))],
    ];
    for (const [what, d] of cases) expect(() => validateBody(d), what).toThrow();
  });

  it('defaults: 16 in a paragraph or list, the heading sizes in headings', () => {
    expect(defaultSizeOf({ type: { name: 'paragraph' }, attrs: {} })).toBe(16);
    expect([1, 2, 3].map((level) => defaultSizeOf({ type: { name: 'heading' }, attrs: { level } }))).toEqual([26, 21, 18]);
  });
});

describe('schema: underline', () => {
  it('is accepted with no attributes, like bold, with every other mark but code', () => {
    expect(() => validateBody(body(para(t('u', [{ type: 'underline' }]))))).not.toThrow();
    expect(() => validateBody(body(para(t('u', [{ type: 'underline' }, { type: 'link', attrs: { href: 'https://example.com' } }, { type: 'textColor', attrs: { color: 'teal' } }]))))).not.toThrow();
    expect(() => validateBody(body(para(t('u', [{ type: 'underline', attrs: { style: 'x' } }]))))).toThrow();
    expect(() => validateBody(body(para(t('u', [{ type: 'underline' }, { type: 'code' }]))))).toThrow();
    expect(() => validateBody(body({ type: 'codeBlock', content: [t('u', [{ type: 'underline' }])] }))).toThrow();
  });
});

describe('search and saving', () => {
  let env: Env;
  let alice: Client;
  beforeEach(async () => {
    env = await makeEnv();
    alice = await userClient(env, 'alice');
  });
  afterEach(async () => env.close());

  it('search text ignores the marks; a save with sizes and underline round-trips', async () => {
    expect(validateBody(body(para(t('big '), t('word', [size(40), { type: 'underline' }]), t(' end')))).text).toBe('big word end');
    const n = (await alice.post('/api/notes', { folderId: null })).json();
    const b = body(para(t('Plain '), t('enormous', [{ type: 'underline' }, size(48)]), t(' tiny', [size(8)])));
    expect((await alice.put(`/api/notes/${n.id}`, { title: 'Sizes', body: b, version: 1 })).statusCode).toBe(200);
    expect((await alice.get(`/api/notes/${n.id}`)).json().body).toEqual(b);
    expect((await alice.post('/api/search', { query: 'enormous' })).json().results.map((r: { id: string }) => r.id)).toEqual([n.id]);
    expect((await alice.put(`/api/notes/${n.id}`, { title: 'Sizes', body: body(para(t('x', [size(100)]))), version: 2 })).statusCode).toBe(400);
  });
});

describe('the stylesheet', () => {
  const css = fs.readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8');
  it('has one static px rule per size, a unitless line-height for sized text, and the defaults the editor shows', () => {
    const rules = [...css.matchAll(/\[data-font-size='(\d+)'\] \{\s*font-size: (\d+)px;\s*\}/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(rules.length).toBe(89);
    expect(rules.every(([a, b]) => a === b)).toBe(true);
    expect(rules.map(([a]) => a)).toEqual(Array.from({ length: 89 }, (_, i) => i + 8));
    expect(css).toMatch(/\[data-font-size\] \{\s*line-height: 1\.25;\s*\}/);
    expect(css).toMatch(new RegExp(`\\.prose \\{[^}]*font-size: ${TEXT_SIZE_DEFAULT}px;`));
    for (const level of [1, 2, 3]) expect(css).toMatch(new RegExp(`\\.prose h${level} \\{\\s*font-size: ${HEADING_SIZES[level]}px;`));
  });
});
