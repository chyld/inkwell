import { useEffect, useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronDown } from 'lucide-react';
import { DEFAULT_FONT_FAMILY, fontById, NOTE_FONTS_MAX } from '../../shared/fonts';
import { fontsInDoc } from '../../shared/noteRules';
import { api, ApiError } from '../api';
import { useDialogs } from './Dialogs';
import { usePreviews } from '../fonts/previews';
import { listKeys, runKey, usePopoverMenu } from './popoverMenu';

export type FontState = { kind: 'none' } | { kind: 'one'; id: string } | { kind: 'mixed' };

/** The font at the cursor, or across the selection ("mixed" when it has more than one, or text with and without one). */
export function fontStateOf(editor: Editor): FontState {
  const { state } = editor;
  const { empty, $from, ranges } = state.selection;
  const fontOf = (marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[]) =>
    (marks.find((m) => m.type.name === 'fontFamily')?.attrs.font as string | undefined) ?? '';
  let seen = new Set<string>();
  if (empty) seen.add(fontOf(state.storedMarks ?? $from.marks()));
  // Each range of the selection (a table cell selection has one per cell), not the unselected cells between them.
  else
    for (const r of ranges)
      state.doc.nodesBetween(r.$from.pos, r.$to.pos, (n) => {
        if (n.isText) seen.add(fontOf(n.marks));
      });
  if (seen.size === 0) seen = new Set(['']);
  if (seen.size > 1) return { kind: 'mixed' };
  const id = [...seen][0];
  return id ? { kind: 'one', id } : { kind: 'none' };
}

export const NOTE_FONTS_REFUSED = `A note can use at most ${NOTE_FONTS_MAX} fonts.`;

interface Props {
  editor: Editor;
  disabled: boolean;
  onBrowse: () => void;
  notice: (message: string) => void;
}

/** The toolbar's font menu (FONTS-SPEC 8.2): the core below, bound to the editor's selection. */
export function FontPicker({ editor, disabled, onBrowse, notice }: Props) {
  return (
    <FontMenu
      state={fontStateOf(editor)}
      disabled={disabled}
      onBrowse={onBrowse}
      onChoose={(id) => {
        if (id) {
          const used = fontsInDoc(editor.state.doc);
          if (!used.has(id) && used.size >= NOTE_FONTS_MAX) {
            notice(NOTE_FONTS_REFUSED);
            return false;
          }
          editor.chain().focus().setMark('fontFamily', { font: id }).run();
        } else editor.chain().focus().unsetMark('fontFamily', { extendEmptyMarkRange: true }).run();
        return true;
      }}
    />
  );
}

interface MenuProps {
  state: FontState;
  disabled: boolean;
  onBrowse: () => void;
  /** Apply a choice (null: the default font). False: refused; the focus goes back to the button. */
  onChoose: (id: string | null) => boolean;
  /** List the current font even when it is not in the collection (the style form). */
  listCurrent?: boolean;
  /** In a form, keep the focus on the menu's button after choosing (the editor is not involved). */
  refocusAfterChoose?: boolean;
}

/** A font menu: "Inter" first, then the user's collection drawn in their preview faces, then "Browse fonts…". */
export function FontMenu({ state, disabled, onBrowse, onChoose, listCurrent = false, refocusAfterChoose = false }: MenuProps) {
  const [collection, setCollection] = useState<string[] | null>(null);
  const m = usePopoverMenu({ placementDeps: [collection] });
  const dialogs = useDialogs();
  const { open, close } = m;
  const fromCollection = (collection ?? []).filter((id) => fontById(id));
  const fonts = listCurrent && state.kind === 'one' && fontById(state.id) && !fromCollection.includes(state.id) ? [...fromCollection, state.id] : fromCollection;
  // Its own source: the toolbar's menu and the style form's can be on screen together.
  const previewStyle = usePreviews(`menu-${m.popId}`, fonts, open);
  // Items: the default font (Inter) first, then the collection, then "Browse fonts…".
  const count = fonts.length + 2;
  const currentIdx = state.kind === 'one' ? (fonts.includes(state.id) ? fonts.indexOf(state.id) + 1 : -1) : state.kind === 'none' ? 0 : -1;

  // The collection, fresh each time the menu opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<string[]>('GET', '/fonts/collection').then(
      (ids) => alive && setCollection(Array.isArray(ids) ? ids : []),
      // A failure keeps the list shown (none yet: no "No fonts yet", which would be untrue) and says so (item 15).
      (e) => alive && dialogs.notice(`Your fonts could not be loaded: ${e instanceof ApiError ? e.message : 'could not reach the server.'}`),
    );
    return () => {
      alive = false;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    m.focusItem(currentIdx >= 0 ? currentIdx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collection]);

  function choose(id: string | null) {
    const done = onChoose(id);
    close(!done || refocusAfterChoose);
  }

  // Enter and Space are left to the browser: they click the focused row.
  const onKeyDown = (e: KeyboardEvent) => void runKey(e, listKeys(m, count));

  const label = state.kind === 'one' ? (fontById(state.id)?.family ?? DEFAULT_FONT_FAMILY) : state.kind === 'mixed' ? 'Mixed' : DEFAULT_FONT_FAMILY;
  const name = `Font: ${label}`;
  const item = (i: number, content: ReactNode, onClick: () => void, extra: Record<string, unknown> = {}) => (
    <button key={i} {...m.itemProps(i)} type="button" className="font-item" onClick={onClick} {...extra}>
      {content}
    </button>
  );

  return (
    <span className="color-tool font-tool" ref={m.wrapRef}>
      <button {...m.buttonProps} type="button" className={'tb font-button' + (open ? ' active' : '')} title={name} aria-label={name} aria-haspopup="true" disabled={disabled}>
        <span className="font-button-label">{label}</span>
        <ChevronDown />
      </button>
      {open && (
        <div {...m.popoverProps} className={'font-popover' + (m.place?.above ? ' above' : '')} role="group" aria-label="Font" onKeyDown={onKeyDown}>
          {/* The list scrolls on its own; its rows keep their height. The footer stays below it, always visible. */}
          <div className="menu-scroll">
            {item(0, <span className="font-default-name">{DEFAULT_FONT_FAMILY}</span>, () => choose(null), {
              'aria-pressed': state.kind === 'none',
              'aria-label': `${DEFAULT_FONT_FAMILY} (default)`,
              className: 'font-item font-default',
            })}
            {collection !== null && fonts.length === 0 && <p className="font-empty">No fonts yet</p>}
            {fonts.map((id, i) =>
              item(i + 1, <span style={previewStyle(id)}>{fontById(id)!.family}</span>, () => choose(id), {
                'aria-pressed': state.kind === 'one' && state.id === id,
                'data-font-id': id,
              }),
            )}
          </div>
          <div className="menu-footer">
            {item(fonts.length + 1, 'Browse fonts…', () => {
              close(false);
              onBrowse();
            }, { className: 'font-item font-browse' })}
          </div>
        </div>
      )}
    </span>
  );
}
