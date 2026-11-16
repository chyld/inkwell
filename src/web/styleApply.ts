// Applying a style to text (STYLES-SPEC 5) and reading a style from text (8). A style is a stamp:
// it sets the eight marks on the text at that moment; the text keeps no record of the style.
import type { Editor } from '@tiptap/react';
import type { Mark, MarkType, Node as PMNode, Schema } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { NOTE_FONTS_MAX } from '../shared/fonts';
import { defaultSizeOf, fontsInDoc } from '../shared/schema';
import type { StyleSettings } from './components/StyleSample';

/** The eight mark types a style sets. */
export const STYLE_MARK_NAMES = ['fontFamily', 'fontSize', 'bold', 'italic', 'underline', 'strike', 'textColor', 'highlight'] as const;

const types = (schema: Schema): MarkType[] => STYLE_MARK_NAMES.map((n) => schema.marks[n]);

/** The style's marks for text in this block: the size by the block rule (none when it equals the block's default). */
export function styleMarks(schema: Schema, s: StyleSettings, block: PMNode): Mark[] {
  const m = schema.marks;
  const out: Mark[] = [];
  if (s.font) out.push(m.fontFamily.create({ font: s.font }));
  if (s.size !== defaultSizeOf(block)) out.push(m.fontSize.create({ size: s.size }));
  if (s.bold) out.push(m.bold.create());
  if (s.italic) out.push(m.italic.create());
  if (s.underline) out.push(m.underline.create());
  if (s.strike) out.push(m.strike.create());
  if (s.textColor) out.push(m.textColor.create({ color: s.textColor }));
  if (s.highlight) out.push(m.highlight.create({ color: s.highlight }));
  return out;
}

const inCode = (node: PMNode, parent: PMNode) => !!parent.type.spec.code || node.marks.some((x) => x.type.name === 'code');

/** Each piece of selected text that can take marks, with its block (in document order). */
function markablePieces(editor: Editor): { from: number; to: number; node: PMNode; block: PMNode }[] {
  const { state } = editor;
  const out: { from: number; to: number; node: PMNode; block: PMNode }[] = [];
  const ranges = [...state.selection.ranges].sort((a, b) => a.$from.pos - b.$from.pos);
  for (const r of ranges) {
    const from = r.$from.pos;
    const to = r.$to.pos;
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!node.isText || !parent || inCode(node, parent)) return;
      const a = Math.max(pos, from);
      const b = Math.min(pos + node.nodeSize, to);
      if (a < b) out.push({ from: a, to: b, node, block: parent });
    });
  }
  return out;
}

/** 5.3: the Styles button is disabled in inline code or a code block, and for a selection with no text that can take marks. */
export function canUseStyles(editor: Editor): boolean {
  const { selection } = editor.state;
  if (selection.empty) {
    const { $from } = selection;
    if ($from.parent.type.spec.code) return false;
    return !(editor.state.storedMarks ?? $from.marks()).some((m) => m.type.name === 'code');
  }
  return markablePieces(editor).length > 0;
}

export type ApplyResult = 'applied' | 'too-many-fonts' | 'nothing';

/**
 * 5.1 with a selection: one transaction (its own undo step) leaving every selected piece of text, outside
 * code, with exactly the style's marks; links and structure untouched. 5.2 without: the marks for what is
 * typed next. Refused (nothing applied) if the note would hold more than 50 distinct fonts.
 */
export function applyStyle(editor: Editor, s: StyleSettings): ApplyResult {
  const { state } = editor;
  const { schema, selection } = state;
  const styleTypes = types(schema);
  if (selection.empty) {
    if (s.font) {
      const used = fontsInDoc(state.doc);
      if (!used.has(s.font) && used.size >= NOTE_FONTS_MAX) return 'too-many-fonts';
    }
    let marks: readonly Mark[] = (state.storedMarks ?? selection.$from.marks()).filter((m) => !styleTypes.includes(m.type));
    for (const m of styleMarks(schema, s, selection.$from.parent)) marks = m.addToSet(marks);
    editor.view.dispatch(state.tr.setStoredMarks([...marks]));
    return 'applied';
  }
  const pieces = markablePieces(editor);
  if (pieces.length === 0) return 'nothing';
  const tr = state.tr;
  closeHistory(tr); // one Undo reverses the style and nothing else, even right after typing
  for (const p of pieces) {
    for (const t of styleTypes) tr.removeMark(p.from, p.to, t);
    for (const m of styleMarks(schema, s, p.block)) tr.addMark(p.from, p.to, m);
  }
  if (fontsInDoc(tr.doc).size > NOTE_FONTS_MAX) return 'too-many-fonts';
  editor.view.dispatch(tr);
  return 'applied';
}

/**
 * 8: the style of one piece of text: with a selection, the first text in it in document order; with none,
 * the formatting in effect at the cursor (as 5.2 starts from).
 */
export function styleFromText(editor: Editor): StyleSettings {
  const { state } = editor;
  let marks: readonly Mark[];
  let block: PMNode;
  if (state.selection.empty) {
    marks = state.storedMarks ?? state.selection.$from.marks();
    block = state.selection.$from.parent;
  } else {
    const first = markablePieces(editor)[0];
    marks = first ? first.node.marks : state.selection.$from.marks();
    block = first ? first.block : state.selection.$from.parent;
  }
  const find = (name: string) => marks.find((m) => m.type.name === name);
  const has = (name: string) => !!find(name);
  const size = find('fontSize')?.attrs.size;
  return {
    font: (find('fontFamily')?.attrs.font as string | undefined) ?? null,
    size: typeof size === 'number' ? size : defaultSizeOf(block),
    bold: has('bold'),
    italic: has('italic'),
    underline: has('underline'),
    strike: has('strike'),
    textColor: (find('textColor')?.attrs.color as string | undefined) ?? null,
    highlight: (find('highlight')?.attrs.color as string | undefined) ?? null,
  };
}
