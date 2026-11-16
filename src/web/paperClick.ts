// A press on the paper around the text (its padding, or below the last line) lands outside the editable element,
// so the browser and ProseMirror ignore it: an image stayed selected and the focus left the editor. It acts like a
// press on the nearest point of the text instead (CLEANUP-PLAN pass 2 item 5b).
import { Selection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** The text selection for a click at (x, y) outside the text: the point clamped into the text column, then the
 *  nearest position that takes a cursor. Null when there is none. */
export function selectionFromPaper(view: EditorView, x: number, y: number): Selection | null {
  const r = view.dom.getBoundingClientRect();
  const left = Math.min(Math.max(x, r.left + 1), r.right - 1);
  const top = Math.min(Math.max(y, r.top + 1), r.bottom - 1);
  const hit = view.posAtCoords({ left, top });
  if (!hit) return null;
  const $pos = view.state.doc.resolve(hit.pos);
  return Selection.findFrom($pos, 1, true) ?? Selection.findFrom($pos, -1, true);
}
