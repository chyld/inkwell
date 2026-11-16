import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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

/** Toolbar button with a popover of colour swatches (by name; the theme supplies the value) and Remove. */
export function ColorPicker({ editor, mark, colors, label, removeLabel, icon, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const [shift, setShift] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const popId = useId();
  const attr = mark === 'textColor' ? 'data-text-color' : 'data-highlight';
  const raw = editor.getAttributes(mark).color;
  const current = typeof raw === 'string' && colors.includes(raw) ? raw : null;
  const count = colors.length + 1; // the swatches, then Remove

  // On opening: focus the colour in use (or the first), keep the popover on screen, close on an outside click.
  useLayoutEffect(() => {
    if (!open) return;
    const start = current ? colors.indexOf(current) : 0;
    setFocusIdx(start);
    itemsRef.current[start]?.focus();
    const r = popRef.current?.getBoundingClientRect();
    if (r && r.right > window.innerWidth - 8) setShift(Math.min(0, window.innerWidth - 8 - r.right));
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
    setShift(0);
    if (refocusButton) buttonRef.current?.focus();
  }

  function apply(color: string | null) {
    const chain = editor.chain().focus();
    if (color) chain.setMark(mark, { color }).run();
    else chain.unsetMark(mark, { extendEmptyMarkRange: true }).run();
    close(false);
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
        {current && <span className={'color-bar' + (mark === 'textColor' ? ' text-bar' : '')} {...{ [attr]: current }} aria-hidden />}
      </button>
      {open && (
        <div
          id={popId}
          ref={popRef}
          className="color-popover"
          role="group"
          aria-label={label}
          style={shift ? { left: shift } : undefined}
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
              <span className={mark === 'textColor' ? 'swatch-dot' : 'swatch-chip'} {...{ [attr]: c }} />
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
            <Eraser /> Remove
          </button>
        </div>
      )}
    </span>
  );
}
