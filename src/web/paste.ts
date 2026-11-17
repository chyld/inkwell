// What a paste into the editor goes through (transformPasted in NoteEditor.tsx): header cells only in a table's
// first row, and no more than 50 fonts in the note.
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { NOTE_FONTS_MAX } from '../shared/fonts';
import { fontsInDoc } from '../shared/noteRules';
import { attrAllowed } from '../shared/schema';

/**
 * A paste that would bring the note past 50 fonts keeps the fonts already in the note (and new ones up
 * to the limit, in order) and drops the marks of the extra ones (FONTS-SPEC 8.1).
 */
export function limitPastedFonts(slice: Slice, editor: Editor): Slice {
  const used = fontsInDoc(editor.state.doc);
  // Most pastes stay within the limit: then the slice is returned as it is, without rebuilding it.
  const pasted = new Set<string>();
  slice.content.descendants((n) => {
    for (const m of n.marks) if (m.type.name === 'fontFamily' && !used.has(m.attrs.font as string)) pasted.add(m.attrs.font as string);
  });
  if (used.size + pasted.size <= NOTE_FONTS_MAX) return slice;
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

/**
 * Pasted HTML can give attributes values the server's validator refuses (a link or image title over 1000
 * characters, a code block's long language name, a list starting below 0), and then every save of the note fails.
 * Each such attribute takes its default (BUGFIX-LIST-2 item 10, as item 6 did for a link's class and target).
 */
export function fixPastedAttrs(slice: Slice): Slice {
  const fixed = (kind: 'node' | 'mark', type: string, attrs: Record<string, unknown>, spec: Record<string, { default?: unknown }> | undefined) => {
    let out: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(attrs)) {
      if (attrAllowed(kind, type, k, v)) continue;
      out ??= { ...attrs };
      out[k] = spec?.[k]?.default ?? null;
    }
    return out;
  };
  let changed = false;
  const mapNode = (node: PMNode): PMNode => {
    const marks = node.marks.map((m) => {
      const a = fixed('mark', m.type.name, m.attrs, m.type.spec.attrs as never);
      if (!a) return m;
      changed = true;
      return m.type.create(a);
    });
    const attrs = fixed('node', node.type.name, node.attrs, node.type.spec.attrs as never);
    if (attrs) changed = true;
    if (node.isText) return marks.some((m, i) => m !== node.marks[i]) ? node.mark(marks) : node;
    const kids: PMNode[] = [];
    node.forEach((c) => kids.push(mapNode(c)));
    return node.type.create(attrs ?? node.attrs, Fragment.from(kids), marks);
  };
  const kids: PMNode[] = [];
  slice.content.forEach((c) => kids.push(mapNode(c)));
  return changed ? new Slice(Fragment.from(kids), slice.openStart, slice.openEnd) : slice;
}

/** Convert header cells outside a table's first row into normal cells (pasted tables). */
export function fixPastedTables(slice: Slice, editor: Editor): Slice {
  // Only a slice with a header cell below a table's first row is rebuilt; any other is returned as it is.
  let headerBelow = false;
  slice.content.descendants((node) => {
    if (node.type.name === 'table') node.forEach((row, _o, i) => i > 0 && row.forEach((cell) => void (headerBelow ||= cell.type.name === 'tableHeader')));
    return !headerBelow;
  });
  if (!headerBelow) return slice;
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
