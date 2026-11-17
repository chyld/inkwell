// @vitest-environment happy-dom
// BUGFIX-LIST item 13: with a table cell selection (one column across two rows), the font menu and the size control
// read and change every selected cell and no other. Before, they used selection.from/to, which for a cell selection
// are the FIRST cell's only: the other selected cells were ignored (unselected cells were not touched, as the review
// supposed). They now walk selection.ranges.
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { EDITOR_EXTENSIONS } from '../../src/web/components/NoteEditor';
import { fontStateOf } from '../../src/web/components/FontPicker';
import { applySize, sizeStateOf } from '../../src/web/components/FontSizeControl';
import { installFontEnv } from './fonts-env';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const text = (t: string, marks: object[] = []) => ({ type: 'text', text: t, ...(marks.length ? { marks } : {}) });
const cell = (...c: object[]) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: c }] });
// Row 1, column 3 is in Lora at 30 px; the selection is column 2, rows 1 and 2.
const styled = [{ type: 'fontFamily', attrs: { font: 'lora' } }, { type: 'fontSize', attrs: { size: 30 } }];
const doc = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell(text('a1')), cell(text('b1')), cell(text('c1', styled))] },
        { type: 'tableRow', content: [cell(text('a2')), cell(text('b2')), cell(text('c2'))] },
        { type: 'tableRow', content: [cell(text('a3')), cell(text('b3')), cell(text('c3'))] },
      ],
    },
  ],
};
function cellPos(e: Editor, label: string) {
  let at = -1;
  e.state.doc.descendants((n, pos) => {
    if (at < 0 && (n.type.name === 'tableCell' || n.type.name === 'tableHeader') && n.textContent === label) at = pos;
  });
  return at;
}
function selectColumn2(e: Editor) {
  e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, cellPos(e, 'b1'), cellPos(e, 'b2'))));
}
const sizeOf = (e: Editor, label: string) => {
  let s: unknown = null;
  e.state.doc.descendants((n) => {
    if (n.isText && n.text === label) s = n.marks.find((m) => m.type.name === 'fontSize')?.attrs.size ?? null;
  });
  return s;
};

describe('a table cell selection', () => {
  it('the font menu and the size field read only the selected cells', () => {
    installFontEnv();
    editor = new Editor({ element: document.createElement('div'), extensions: EDITOR_EXTENSIONS, content: doc });
    selectColumn2(editor);
    expect(fontStateOf(editor)).toEqual({ kind: 'none' }); // c1, between the selected cells but unselected, does not count
    expect(sizeStateOf(editor)).toEqual({ current: 16, min: 16, max: 16 });
  });

  it('they read every selected cell, not only the first (the second selected cell is in Lora at 30 px)', () => {
    const second = structuredClone(doc);
    (second.content[0].content[1].content[1] as any).content[0].content[0].marks = styled; // b2
    (second.content[0].content[0].content[2] as any).content[0].content[0].marks = undefined; // c1 plain
    editor = new Editor({ element: document.createElement('div'), extensions: EDITOR_EXTENSIONS, content: second });
    selectColumn2(editor);
    expect(fontStateOf(editor)).toEqual({ kind: 'mixed' }); // before: none (only b1 was read)
    expect(sizeStateOf(editor)).toEqual({ current: 16, min: 16, max: 30 }); // before: 16 to 16
  });

  it('+ changes only the selected cells', () => {
    editor = new Editor({ element: document.createElement('div'), extensions: EDITOR_EXTENSIONS, content: doc });
    selectColumn2(editor);
    applySize(editor, (n) => n + 1);
    expect([sizeOf(editor, 'b1'), sizeOf(editor, 'b2')]).toEqual([17, 17]); // before: b2 unchanged
    expect(sizeOf(editor, 'c1')).toBe(30);
    expect(sizeOf(editor, 'a2')).toBeNull();
  });
});
