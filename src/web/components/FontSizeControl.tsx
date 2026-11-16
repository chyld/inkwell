// Text size for selected text: − / size / + in the toolbar. A size equal to the block's default is
// never stored: the mark is removed instead, so the default is always reachable.
import { useEffect, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { Minus, Plus } from 'lucide-react';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, defaultSizeOf } from '../../shared/noteRules';

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
    const v = text.trim();
    if (/^[0-9]{1,2}$/.test(v) && Number(v) >= FONT_SIZE_MIN && Number(v) <= FONT_SIZE_MAX) {
      const n = Number(v);
      applySize(editor, () => n);
      editor.commands.focus();
    }
    setEditing(false);
    setText(String(sizeStateOf(editor).current)); // anything else: the old value back
  }

  const button = (label: string, icon: ReactNode, enabled: boolean, step: number) => (
    <button
      type="button"
      className="tb"
      aria-label={label}
      title={label}
      disabled={disabled || !enabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => applySize(editor, (n) => n + step)}
    >
      {icon}
    </button>
  );

  return (
    <div className="tb-group size-group" role="group" aria-label="Font size">
      {button('Decrease font size', <Minus />, s.max > FONT_SIZE_MIN, -1)}
      <input
        className="size-input"
        type="text"
        inputMode="numeric"
        aria-label="Font size"
        title="Font size"
        disabled={disabled}
        value={text}
        maxLength={2}
        onFocus={(e) => {
          setEditing(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setText(String(s.current));
            setEditing(false);
            editor.commands.focus();
          }
        }}
        onBlur={() => {
          if (editing) {
            setEditing(false);
            setText(String(sizeStateOf(editor).current));
          }
        }}
      />
      {button('Increase font size', <Plus />, s.min < FONT_SIZE_MAX, 1)}
    </div>
  );
}
