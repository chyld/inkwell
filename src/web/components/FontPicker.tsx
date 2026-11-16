import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronDown } from 'lucide-react';
import { DEFAULT_FONT_FAMILY, fontById, NOTE_FONTS_MAX } from '../../shared/fonts';
import { fontsInDoc } from '../../shared/schema';
import { api } from '../api';
import { usePreviews } from '../fonts/previews';
import { placementStyle, useMenuPlacement } from './menuPlacement';

export type FontState = { kind: 'none' } | { kind: 'one'; id: string } | { kind: 'mixed' };

/** The font at the cursor, or across the selection ("mixed" when it has more than one, or text with and without one). */
export function fontStateOf(editor: Editor): FontState {
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  const fontOf = (marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[]) =>
    (marks.find((m) => m.type.name === 'fontFamily')?.attrs.font as string | undefined) ?? '';
  let seen = new Set<string>();
  if (empty) seen.add(fontOf(state.storedMarks ?? $from.marks()));
  else
    state.doc.nodesBetween(from, to, (n) => {
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
  const [open, setOpen] = useState(false);
  const [collection, setCollection] = useState<string[] | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const popId = useId();
  const fromCollection = (collection ?? []).filter((id) => fontById(id));
  const fonts = listCurrent && state.kind === 'one' && fontById(state.id) && !fromCollection.includes(state.id) ? [...fromCollection, state.id] : fromCollection;
  // Its own source: the toolbar's menu and the style form's can be on screen together.
  const previewStyle = usePreviews(`menu-${popId}`, fonts, open);
  // Items: the default font (Inter) first, then the collection, then "Browse fonts…".
  const count = fonts.length + 2;
  const currentIdx = state.kind === 'one' ? (fonts.includes(state.id) ? fonts.indexOf(state.id) + 1 : -1) : state.kind === 'none' ? 0 : -1;

  // The collection, fresh each time the menu opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<string[]>('GET', '/fonts/collection').then(
      (ids) => alive && setCollection(Array.isArray(ids) ? ids : []),
      () => alive && setCollection((c) => c ?? []),
    );
    return () => {
      alive = false;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const start = currentIdx >= 0 ? currentIdx : 0;
    setFocusIdx(start);
    itemsRef.current[start]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collection]);
  const place = useMenuPlacement(open, wrapRef, popRef, [collection]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function close(refocusButton: boolean) {
    setOpen(false);
    if (refocusButton) buttonRef.current?.focus();
  }

  function choose(id: string | null) {
    const done = onChoose(id);
    close(!done || refocusAfterChoose);
  }

  function move(to: number) {
    const i = (to + count) % count;
    setFocusIdx(i);
    itemsRef.current[i]?.focus();
    itemsRef.current[i]?.scrollIntoView?.({ block: 'nearest' });
  }

  function onKeyDown(e: KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(focusIdx + 1),
      ArrowRight: () => move(focusIdx + 1),
      ArrowUp: () => move(focusIdx - 1),
      ArrowLeft: () => move(focusIdx - 1),
      Home: () => move(0),
      End: () => move(count - 1),
      Escape: () => close(true),
    };
    const k = keys[e.key];
    if (k) {
      e.preventDefault();
      e.stopPropagation();
      k();
    }
  }

  const label = state.kind === 'one' ? (fontById(state.id)?.family ?? DEFAULT_FONT_FAMILY) : state.kind === 'mixed' ? 'Mixed' : DEFAULT_FONT_FAMILY;
  const name = `Font: ${label}`;
  const item = (i: number, content: ReactNode, onClick: () => void, extra: Record<string, unknown> = {}) => (
    <button
      key={i}
      ref={(el) => {
        itemsRef.current[i] = el;
      }}
      type="button"
      className="font-item"
      tabIndex={i === focusIdx ? 0 : -1}
      onMouseDown={(e) => e.preventDefault()}
      onFocus={() => setFocusIdx(i)}
      onClick={onClick}
      {...extra}
    >
      {content}
    </button>
  );

  return (
    <span className="color-tool font-tool" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={'tb font-button' + (open ? ' active' : '')}
        title={name}
        aria-label={name}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <span className="font-button-label">{label}</span>
        <ChevronDown />
      </button>
      {open && (
        <div
          id={popId}
          ref={popRef}
          className={'font-popover' + (place?.above ? ' above' : '')}
          role="group"
          aria-label="Font"
          style={placementStyle(place)}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close(false);
          }}
        >
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
