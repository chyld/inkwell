// What a paste goes through (src/web/paste.ts). CLEANUP-PLAN pass 3 item 2: a paste with nothing to fix is
// returned as it is (before: rebuilt node by node twice); one with something to fix is fixed as before.
import { describe, expect, it } from 'vitest';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { noteSchema } from '../../src/shared/schema';
import { FONT_CATALOGUE } from '../../src/shared/fonts';
import { fixPastedTables, limitPastedFonts } from '../../src/web/paste';

const schema = noteSchema();
const doc = (json: object) => schema.nodeFromJSON(json);
const text = (t: string, font?: string) => ({ type: 'text', text: t, ...(font ? { marks: [{ type: 'fontFamily', attrs: { font } }] } : {}) });
const p = (...c: object[]) => ({ type: 'paragraph', content: c });
const cell = (type: string, t: string) => ({ type, content: [p(text(t))] });
const editorWith = (body: PMNode) => ({ schema, state: { doc: body } }) as never;
const sliceOf = (...blocks: object[]) => new Slice(Fragment.fromArray(blocks.map((b) => schema.nodeFromJSON(b))), 0, 0);
const empty = doc({ type: 'doc', content: [p(text('x'))] });
const ids = FONT_CATALOGUE.slice(0, 60).map((f) => f.id);

describe('paste transforms', () => {
  it('return the very same slice when there is nothing to fix', () => {
    const s = sliceOf(p(text('a', ids[0])), { type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'h')] }, { type: 'tableRow', content: [cell('tableCell', 'c')] }] });
    expect(fixPastedTables(s, editorWith(empty))).toBe(s);
    expect(limitPastedFonts(s, editorWith(empty))).toBe(s);
  });

  it('turn header cells below the first row into normal cells', () => {
    const s = sliceOf({ type: 'table', content: [{ type: 'tableRow', content: [cell('tableHeader', 'h')] }, { type: 'tableRow', content: [cell('tableHeader', 'not a header')] }] });
    const out = fixPastedTables(s, editorWith(empty));
    expect(out).not.toBe(s);
    const rows = out.content.firstChild!.toJSON().content;
    expect(rows.map((r: { content: { type: string }[] }) => r.content[0].type)).toEqual(['tableHeader', 'tableCell']);
  });

  it('keep at most 50 fonts in the note: the extra fonts lose their marks, in order', () => {
    const body = doc({ type: 'doc', content: ids.slice(0, 45).map((id) => p(text('t', id))) });
    const s = sliceOf(...ids.slice(40, 60).map((id) => p(text('u', id))));
    const out = limitPastedFonts(s, editorWith(body));
    const fontsOut: (string | null)[] = [];
    out.content.forEach((n) => fontsOut.push((n.firstChild!.marks[0]?.attrs.font as string) ?? null));
    // 40-44 are already in the note; 45-49 bring it to 50; 50-59 are dropped.
    expect(fontsOut).toEqual([...ids.slice(40, 50), ...Array(10).fill(null)]);
  });
});
