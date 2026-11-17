// @vitest-environment happy-dom
// BUGFIX-LIST items 5 and 6: edits that made a note unsaveable (the server refused every save). Each document the
// editor produces from these actions must pass validateBody, the server's own check.
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { validateBody } from '../../src/shared/schema';
import { EDITOR_EXTENSIONS } from '../../src/web/components/NoteEditor';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = (type: string, text: string) => ({ type, content: [p(text)] });
const table = {
  type: 'table',
  content: [
    { type: 'tableRow', content: [cell('tableHeader', 'H1'), cell('tableHeader', 'H2')] },
    { type: 'tableRow', content: [cell('tableCell', 'a'), cell('tableCell', 'b')] },
  ],
};
function make(content: object[]) {
  editor = new Editor({ element: document.createElement('div'), extensions: EDITOR_EXTENSIONS, content: { type: 'doc', content } });
  return editor;
}
const posOf = (e: Editor, text: string) => {
  let at = -1;
  e.state.doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text === text) at = pos;
  });
  return at;
};
const valid = (e: Editor) => () => validateBody(e.getJSON());
const rowTypes = (e: Editor) => (e.getJSON().content!.find((n) => n.type === 'table')!.content as { content: { type: string }[] }[]).map((r) => r.content.map((c) => c.type));

describe('table header cells stay in the first row (item 5)', () => {
  it('"Row above" on the header row: the old header row becomes plain cells; the note stays saveable', () => {
    const e = make([table]);
    e.chain().setTextSelection(posOf(e, 'H1')).addRowBefore().run();
    expect(rowTypes(e)).toEqual([['tableCell', 'tableCell'], ['tableCell', 'tableCell'], ['tableCell', 'tableCell']]);
    expect(valid(e)).not.toThrow(); // before: 'table: header cells are allowed only in the first row'
  });

  it('header cells pasted into a lower row become plain cells', () => {
    const e = make([table]);
    e.commands.setTextSelection(posOf(e, 'b'));
    e.view.pasteHTML('<table><tr><th>X</th><th>Y</th></tr></table>');
    expect(rowTypes(e).slice(1).flat()).not.toContain('tableHeader');
    expect(valid(e)).not.toThrow();
  });
});

describe('links pasted from web pages (item 6)', () => {
  it('a class, a target other than _blank and an over-long rel are not kept; the note stays saveable', () => {
    const e = make([p('x')]);
    e.commands.setTextSelection(2);
    e.view.pasteHTML(`<p><a href="https://example.com/a" class="btn btn-link" target="_self" rel="${'r'.repeat(120)}">a page</a></p>`);
    const link = JSON.stringify(e.getJSON()).match(/"type":"link","attrs":(\{[^}]*\})/)![1];
    expect(JSON.parse(link)).toEqual({ href: 'https://example.com/a', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null });
    expect(valid(e)).not.toThrow(); // before: 'link: attribute "class" has a value that is not allowed'
  });

  it('a pasted link with target _blank and a short rel keeps them', () => {
    const e = make([p('x')]);
    e.commands.setTextSelection(2);
    e.view.pasteHTML('<p><a href="https://example.com/b" target="_blank" rel="noopener">b</a></p>');
    const link = JSON.parse(JSON.stringify(e.getJSON()).match(/"type":"link","attrs":(\{[^}]*\})/)![1]);
    expect([link.target, link.rel]).toEqual(['_blank', 'noopener']);
    expect(valid(e)).not.toThrow();
  });
});
