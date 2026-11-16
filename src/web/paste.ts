// What a paste into the editor goes through (transformPasted in NoteEditor.tsx): header cells only in a table's
// first row, and no more than 50 fonts in the note.
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { NOTE_FONTS_MAX } from '../shared/fonts';
import { fontsInDoc } from '../shared/noteRules';

/**
 * A paste that would bring the note past 50 fonts keeps the fonts already in the note (and new ones up
 * to the limit, in order) and drops the marks of the extra ones (FONTS-SPEC 8.1).
 */
export function limitPastedFonts(slice: Slice, editor: Editor): Slice {
  const used = fontsInDoc(editor.state.doc);
  const added = new Set<string>();
  let dropped = false;
  const keep = (id: string) => {
    if (used.has(id) || added.has(id)) return true;
    if (used.size + added.size >= NOTE_FONTS_MAX) return false;
    added.add(id);
    return true;
  };
  const mapNode = (node: PMNode): PMNode => {
    if (node.isText) {
      const font = node.marks.find((m) => m.type.name === 'fontFamily');
      if (font && !keep(font.attrs.font as string)) {
        dropped = true;
        return node.mark(font.removeFromSet(node.marks));
      }
      return node;
    }
    const kids: PMNode[] = [];
    node.forEach((c) => kids.push(mapNode(c)));
    return node.copy(Fragment.fromArray(kids));
  };
  const kids: PMNode[] = [];
  slice.content.forEach((c) => kids.push(mapNode(c)));
  return dropped ? new Slice(Fragment.fromArray(kids), slice.openStart, slice.openEnd) : slice;
}

/** Convert header cells outside a table's first row into normal cells (pasted tables). */
export function fixPastedTables(slice: Slice, editor: Editor): Slice {
  const schema = editor.schema;
  const mapNode = (node: PMNode): PMNode => {
    if (node.type.name === 'table') {
      const rows: PMNode[] = [];
      node.forEach((row, _o, i) => {
        const cells: PMNode[] = [];
        row.forEach((cell) => {
          cells.push(i > 0 && cell.type.name === 'tableHeader' ? schema.nodes.tableCell.create(cell.attrs, cell.content, cell.marks) : mapNode(cell));
        });
        rows.push(row.copy(Fragment.from(cells)));
      });
      return node.copy(Fragment.from(rows));
    }
    if (node.isLeaf || node.isText) return node;
    const kids: PMNode[] = [];
    node.forEach((c) => kids.push(mapNode(c)));
    return node.copy(Fragment.from(kids));
  };
  const kids: PMNode[] = [];
  slice.content.forEach((c) => kids.push(mapNode(c)));
  return new Slice(Fragment.from(kids), slice.openStart, slice.openEnd);
}
