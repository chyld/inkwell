import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { placementStyle, useMenuPlacement } from './menuPlacement';
import type { Editor } from '@tiptap/react';
import { Eraser } from 'lucide-react';

const COLUMNS = 4;
const nameOf = (c: string) => c[0].toUpperCase() + c.slice(1);

interface Props {
  editor: Editor;
  mark: 'textColor' | 'highlight';
  colors: readonly string[];
  /** e.g. "Text colour"; the button's name, and the popover's. */
  label: string;
  removeLabel: string;
  icon: ReactNode;
  disabled: boolean;
}

/** The toolbar's colour menu: the core below, bound to the editor's selection. */
export function ColorPicker({ editor, mark, ...rest }: Props) {
  const raw = editor.getAttributes(mark).color;
  return (
    <ColorMenu
      {...rest}
      kind={mark}
      current={typeof raw === 'string' ? raw : null}
      onPick={(color) => {
        const chain = editor.chain().focus();
        if (color) chain.setMark(mark, { color }).run();
        else chain.unsetMark(mark, { extendEmptyMarkRange: true }).run();
      }}
    />
  );
}

interface MenuProps {
  kind: 'textColor' | 'highlight';
  colors: readonly string[];
  current: string | null;
  onPick: (color: string | null) => void;
  label: string;
  removeLabel: string;
  /** The visible text of the last entry ("Remove" in the toolbar, "None" in the style form). */
  removeText?: string;
  icon: ReactNode;
  disabled: boolean;
  /** In a form, keep the focus on the menu's button after choosing (the editor is not involved). */
  refocusAfterPick?: boolean;
}

/** A button with a popover of colour swatches (by name; the theme supplies the value) and Remove/None. */
export function ColorMenu({ kind, colors, current: currentRaw, onPick, label, removeLabel, removeText = 'Remove', icon, disabled, refocusAfterPick = false }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const popId = useId();
  const attr = kind === 'textColor' ? 'data-text-color' : 'data-highlight';
  const current = currentRaw && colors.includes(currentRaw) ? currentRaw : null;
  const count = colors.length + 1; // the swatches, then Remove

  const place = useMenuPlacement(open, wrapRef, popRef, []);
  // On opening: focus the colour in use (or the first), keep the popover on screen, close on an outside click.
  useLayoutEffect(() => {
    if (!open) return;
    const start = current ? colors.indexOf(current) : 0;
    setFocusIdx(start);
    itemsRef.current[start]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
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

  function apply(color: string | null) {
    onPick(color);
    close(refocusAfterPick);
  }

  function move(to: number) {
    const i = (to + count) % count;
    setFocusIdx(i);
    itemsRef.current[i]?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    const i = focusIdx;
    const removeIdx = count - 1;
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(i + 1),
      ArrowLeft: () => move(i - 1),
      ArrowDown: () => move(i === removeIdx ? 0 : Math.min(i + COLUMNS, removeIdx)),
      ArrowUp: () => move(i === removeIdx ? removeIdx - COLUMNS : i - COLUMNS < 0 ? removeIdx : i - COLUMNS),
      Home: () => move(0),
      End: () => move(removeIdx),
      Escape: () => close(true),
    };
    const k = keys[e.key];
    if (k) {
      e.preventDefault();
      e.stopPropagation();
      k();
    }
  }

  const name = current ? `${label}: ${nameOf(current)}` : label;
  return (
    <span className="color-tool" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={'tb has-bar' + (open ? ' active' : '')}
        title={name}
        aria-label={name}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        {icon}
        {current && <span className={'color-bar' + (kind === 'textColor' ? ' text-bar' : '')} {...{ [attr]: current }} aria-hidden />}
      </button>
      {open && (
        <div
          id={popId}
          ref={popRef}
          className="color-popover"
          role="group"
          aria-label={label}
          style={placementStyle(place)}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close(false);
          }}
        >
          {colors.map((c, i) => (
            <button
              key={c}
              ref={(el) => {
                itemsRef.current[i] = el;
              }}
              type="button"
              className="swatch"
              aria-label={nameOf(c)}
              title={nameOf(c)}
              aria-pressed={c === current}
              tabIndex={i === focusIdx ? 0 : -1}
              onMouseDown={(e) => e.preventDefault()}
              onFocus={() => setFocusIdx(i)}
              onClick={() => apply(c)}
            >
              <span className={kind === 'textColor' ? 'swatch-dot' : 'swatch-chip'} {...{ [attr]: c }} />
            </button>
          ))}
          <button
            ref={(el) => {
              itemsRef.current[colors.length] = el;
            }}
            type="button"
            className="swatch swatch-remove"
            aria-label={removeLabel}
            title={removeLabel}
            tabIndex={focusIdx === colors.length ? 0 : -1}
            onMouseDown={(e) => e.preventDefault()}
            onFocus={() => setFocusIdx(colors.length)}
            onClick={() => apply(null)}
          >
            <Eraser /> {removeText}
          </button>
        </div>
      )}
    </span>
  );
}
