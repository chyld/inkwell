import { useLayoutEffect, type KeyboardEvent, type ReactNode } from 'react';
import { runKey, usePopoverMenu } from './popoverMenu';
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
  const m = usePopoverMenu();
  const { open, close } = m;
  const attr = kind === 'textColor' ? 'data-text-color' : 'data-highlight';
  const current = currentRaw && colors.includes(currentRaw) ? currentRaw : null;
  const count = colors.length + 1; // the swatches, then Remove

  // On opening: focus the colour in use (or the first).
  useLayoutEffect(() => {
    if (!open) return;
    m.focusItem(current ? colors.indexOf(current) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function apply(color: string | null) {
    onPick(color);
    close(refocusAfterPick);
  }

  /** The swatches are a grid of COLUMNS with Remove after them; every move wraps. Enter and Space click. */
  function onKeyDown(e: KeyboardEvent) {
    const i = m.focusIdx;
    const removeIdx = count - 1;
    const move = (to: number) => m.focusItem((to + count) % count);
    runKey(e, {
      ArrowRight: () => move(i + 1),
      ArrowLeft: () => move(i - 1),
      ArrowDown: () => move(i === removeIdx ? 0 : Math.min(i + COLUMNS, removeIdx)),
      ArrowUp: () => move(i === removeIdx ? removeIdx - COLUMNS : i - COLUMNS < 0 ? removeIdx : i - COLUMNS),
      Home: () => move(0),
      End: () => move(removeIdx),
      Escape: () => close(true),
    });
  }

  const name = current ? `${label}: ${nameOf(current)}` : label;
  return (
    <span className="color-tool" ref={m.wrapRef}>
      <button {...m.buttonProps} type="button" className={'tb has-bar' + (open ? ' active' : '')} title={name} aria-label={name} aria-haspopup="true" disabled={disabled}>
        {icon}
        {current && <span className={'color-bar' + (kind === 'textColor' ? ' text-bar' : '')} {...{ [attr]: current }} aria-hidden />}
      </button>
      {open && (
        <div {...m.popoverProps} className="color-popover" role="group" aria-label={label} onKeyDown={onKeyDown}>
          {colors.map((c, i) => (
            <button key={c} {...m.itemProps(i)} type="button" className="swatch" aria-label={nameOf(c)} title={nameOf(c)} aria-pressed={c === current} onClick={() => apply(c)}>
              <span className={kind === 'textColor' ? 'swatch-dot' : 'swatch-chip'} {...{ [attr]: c }} />
            </button>
          ))}
          <button {...m.itemProps(colors.length)} type="button" className="swatch swatch-remove" aria-label={removeLabel} title={removeLabel} onClick={() => apply(null)}>
            <Eraser /> {removeText}
          </button>
        </div>
      )}
    </span>
  );
}
