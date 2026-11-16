// Text size for selected text: − / size / + in the toolbar. A size equal to the block's default is
// never stored: the mark is removed instead, so the default is always reachable.
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, defaultSizeOf } from '../../shared/noteRules';
import { parseSize, SizeStepper } from './SizeStepper';

const clamp = (n: number) => Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));
const markSize = (marks: readonly Mark[]) => marks.find((m) => m.type.name === 'fontSize')?.attrs.size as number | undefined;

export interface SizeState {
  /** The effective size at the cursor, or at the start of the selection. */
  current: number;
  /** The smallest and largest effective sizes in the selection. */
  min: number;
  max: number;
}

export function sizeStateOf(editor: Editor): SizeState {
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const s = markSize(state.storedMarks ?? $from.marks()) ?? defaultSizeOf($from.parent);
    return { current: s, min: s, max: s };
  }
  const sizes: number[] = [];
  state.doc.nodesBetween(from, to, (node: PMNode, _pos: number, parent: PMNode | null) => {
    if (node.isText && parent) sizes.push(markSize(node.marks) ?? defaultSizeOf(parent));
  });
  if (sizes.length === 0) {
    const s = defaultSizeOf($from.parent);
    return { current: s, min: s, max: s };
  }
  return { current: sizes[0], min: Math.min(...sizes), max: Math.max(...sizes) };
}

/**
 * Change the size of the selection: each part goes from its own size to `next(size)`, clamped; with
 * no selection, the size of what is typed next (as the colour and font menus do with no selection).
 */
export function applySize(editor: Editor, next: (size: number) => number) {
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  const type = state.schema.marks.fontSize;
  const tr = state.tr;
  if (empty) {
    const marks = state.storedMarks ?? $from.marks();
    const def = defaultSizeOf($from.parent);
    const size = clamp(next(markSize(marks) ?? def));
    const rest = marks.filter((m) => m.type !== type);
    tr.setStoredMarks(size === def ? rest : [...rest, type.create({ size })]);
  } else {
    state.doc.nodesBetween(from, to, (node: PMNode, pos: number, parent: PMNode | null) => {
      if (!node.isText || !parent) return;
      const a = Math.max(pos, from);
      const b = Math.min(pos + node.nodeSize, to);
      const def = defaultSizeOf(parent);
      const size = clamp(next(markSize(node.marks) ?? def));
      if (size === def) tr.removeMark(a, b, type);
      else tr.addMark(a, b, type.create({ size }));
    });
  }
  editor.view.dispatch(tr);
}

export function FontSizeControl({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const s = sizeStateOf(editor);
  const [text, setText] = useState(String(s.current));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(s.current));
  }, [s.current, editing]);

  function commit() {
    const n = parseSize(text);
    if (n !== null) {
      applySize(editor, () => n);
      editor.commands.focus();
    }
    setEditing(false);
    setText(String(sizeStateOf(editor).current)); // anything else: the old value back
  }

  return (
    <SizeStepper
      text={text}
      onText={setText}
      canDecrease={s.max > FONT_SIZE_MIN}
      canIncrease={s.min < FONT_SIZE_MAX}
      onStep={(step) => applySize(editor, (n) => n + step)}
      disabled={disabled}
      keepEditorFocus
      inputProps={{
        onFocus: (e) => {
          setEditing(true);
          e.currentTarget.select();
        },
        onKeyDown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setText(String(s.current));
            setEditing(false);
            editor.commands.focus();
          }
        },
        onBlur: () => {
          if (editing) {
            setEditing(false);
            setText(String(sizeStateOf(editor).current));
          }
        },
      }}
    />
  );
}
