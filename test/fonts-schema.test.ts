// FONTS-SPEC 8.1 on the server: the fontFamily mark is accepted as specified and every case listed
// there is refused (criterion 7); agents cannot produce it (17); search text ignores it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FONT_CATALOGUE, fontById } from '../src/shared/fonts.js';
import { validateBody } from '../src/shared/schema.js';
import { markdownToDoc } from '../src/server/markdown.js';
import { makeEnv, userClient, type Client, type Env } from './helpers.js';
import { McpTestClient } from './fonts-mcp.js';

const t = (text: string, marks: unknown[] = []) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const body = (...content: unknown[]) => ({ type: 'doc', content });
const font = (f: unknown, extra: Record<string, unknown> = {}) => ({ type: 'fontFamily', attrs: { font: f, ...extra } });

describe('schema: the fontFamily mark', () => {
  it('accepts a catalogue id, combined with bold, italic, strike, link, text colour and highlight', () => {
    const v = validateBody(
      body(para(t('fancy', [{ type: 'bold' }, { type: 'italic' }, { type: 'strike' }, { type: 'link', attrs: { href: 'https://example.com' } }, { type: 'textColor', attrs: { color: 'ruby' } }, { type: 'highlight', attrs: { color: 'topaz' } }, font('titan-one')]))),
    );
    expect(v.serialized).toContain('{"type":"fontFamily","attrs":{"font":"titan-one"}}');
    expect(v.serialized).not.toMatch(/Titan One|font-family|style/);
  });

  it('accepts a retired family (a note stays saveable)', () => {
    const f = fontById('lora')! as { retired: boolean };
    f.retired = true;
    try {
      expect(() => validateBody(body(para(t('x', [font('lora')]))))).not.toThrow();
    } finally {
      f.retired = false;
    }
  });

  it('refuses every case of 8.1', () => {
    const cases: [string, unknown][] = [
      ['font missing', body(para(t('x', [{ type: 'fontFamily', attrs: {} }])))],
      ['no attrs', body(para(t('x', [{ type: 'fontFamily' }])))],
      ['font null', body(para(t('x', [font(null)])))],
      ['font a number', body(para(t('x', [font(7)])))],
      ['font an array', body(para(t('x', [font(['titan-one'])])))],
      ['not in the snapshot', body(para(t('x', [font('no-such-font')])))],
      ['upper case', body(para(t('x', [font('Titan-One')])))],
      ['a family name', body(para(t('x', [font('Titan One')])))],
      ['a path', body(para(t('x', [font('../x')])))],
      ['65 characters', body(para(t('x', [font('a'.repeat(65))])))],
      ['another attribute', body(para(t('x', [font('titan-one', { style: 'font-family: Arial' })])))],
      ['a class', body(para(t('x', [font('titan-one', { class: 'x' })])))],
      ['with inline code', body(para(t('x', [{ type: 'code' }, font('titan-one')])))],
      ['in a code block', body({ type: 'codeBlock', content: [t('x', [font('titan-one')])] })],
      ['two fonts on the same text', body(para(t('x', [font('titan-one'), font('lora')])))],
    ];
    for (const [what, doc] of cases) expect(() => validateBody(doc), what).toThrow();
  });

  it('refuses a note with more than 50 distinct fonts, and accepts 50', () => {
    const ids = FONT_CATALOGUE.slice(0, 51).map((f) => f.id);
    const doc = (n: number) => body(para(...ids.slice(0, n).map((id, i) => t(`w${i} `, [font(id)]))));
    expect(() => validateBody(doc(50))).not.toThrow();
    expect(() => validateBody(doc(51))).toThrow(/at most 50 fonts/);
    // The same font many times counts once.
    expect(() => validateBody(body(para(...Array.from({ length: 80 }, (_, i) => t(`r${i} `, [font('titan-one')])))))).not.toThrow();
  });

  it('search text and snippets are plain text and ignore the mark', () => {
    expect(validateBody(body(para(t('Plain '), t('fancy', [font('titan-one')]), t(' end')))).text).toBe('Plain fancy end');
  });
});

describe('agents cannot produce a fontFamily, fontSize or underline mark (criterion 17)', () => {
  it('the Markdown converter keeps raw HTML as text and has no font, size or underline syntax', () => {
    const d = markdownToDoc(
      'Hello <span data-font="titan-one">titan</span> and <font face="Lora">lora</font> and <span style="font-family: Lora">x</span> ' +
        'and <span data-font-size="40">big</span> and <font size="7">huge</font> and <span style="font-size: 30px">y</span> and <u>under</u> and <ins>ins</ins>',
    );
    const json = JSON.stringify(d);
    for (const mark of ['fontFamily', 'fontSize', 'underline']) expect(json).not.toContain(`"${mark}"`);
    expect(json).toContain('data-font');
    expect(json).toContain('<u>under</u>'); // raw <u> stays literal text
  });

  describe('through the create_note tool', () => {
    let env: Env;
    let alice: Client;
    beforeEach(async () => {
      env = await makeEnv();
      alice = await userClient(env, 'alice');
    });
    afterEach(async () => env.close());

    it('a note created with HTML that names a font has no mark', async () => {
      const mcp = await McpTestClient.connect(env, 'alice');
      try {
        const id = await mcp.createNote('Fonts by agent', '<span data-font="titan-one">x</span> **bold** <font face="Lora">y</font> <span data-font-size="40">z</span> <u>u</u>');
        const note = (await alice.get(`/api/notes/${id}`)).json();
        for (const mark of ['fontFamily', 'fontSize', 'underline']) expect(JSON.stringify(note.body)).not.toContain(`"${mark}"`);
      } finally {
        await mcp.close();
      }
    });
  });
});

describe('a note keeps its fonts whatever happens to the collection (8.1, 8.4)', () => {
  let env: Env;
  let alice: Client;
  beforeEach(async () => {
    env = await makeEnv();
    alice = await userClient(env, 'alice');
  });
  afterEach(async () => env.close());

  it('saving does not consult the collection', async () => {
    const n = (await alice.post('/api/notes', { folderId: null })).json();
    const doc = body(para(t('in a font nobody collected', [font('caveat')])));
    const r = await alice.put(`/api/notes/${n.id}`, { title: 'x', body: doc, version: 1 });
    expect(r.statusCode, r.body).toBe(200);
    expect((await alice.get(`/api/notes/${n.id}`)).json().body).toEqual(doc);
  });
});
