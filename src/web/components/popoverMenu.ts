// The machinery the toolbar's menus share (font, colours, Styles; Headings, Lists, Blocks and Insert): the open
// state, the focused row (one roving tabindex), the refs, the placement (menuPlacement.ts), closing on a press
// outside and (for most) when the focus leaves, and closing with or without the focus going back to the button.
// Each menu keeps what is its own: its rows, where the focus goes on opening, and its key map.
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { placementStyle, useMenuPlacement } from './menuPlacement';

const keepFocus = (e: MouseEvent) => e.preventDefault(); // a press on the button or a row does not take the focus

export function usePopoverMenu({ placementDeps = [], closeOnFocusOut = true }: { placementDeps?: unknown[]; closeOnFocusOut?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const popId = useId();
  const place = useMenuPlacement(open, wrapRef, popRef, placementDeps);

  function close(refocusButton: boolean) {
    setOpen(false);
    if (refocusButton) buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  /** Move the roving focus to row i (scrolled into view in a scrolling list when asked). */
  function focusItem(i: number, scroll = false) {
    setFocusIdx(i);
    itemsRef.current[i]?.focus();
    if (scroll) itemsRef.current[i]?.scrollIntoView?.({ block: 'nearest' });
  }

  return {
    open,
    setOpen,
    focusIdx,
    setFocusIdx,
    wrapRef,
    itemsRef,
    popId,
    place,
    close,
    focusItem,
    /** The button that opens and closes the menu (its class, name and content are the menu's own). */
    buttonProps: {
      ref: buttonRef,
      'aria-expanded': open,
      'aria-controls': open ? popId : undefined,
      onMouseDown: keepFocus,
      onClick: () => (open ? close(true) : setOpen(true)),
      // Shift+Tab from the menu comes back here with the menu still open: Escape closes it, and only it (not a
      // dialog or the style form around it) (as BUGFIX-LIST-2 item 9).
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !open) return;
        e.preventDefault();
        e.stopPropagation();
        close(true);
      },
    },
    /** The popover element (its class, role and name are the menu's own). */
    popoverProps: {
      id: popId,
      ref: popRef,
      style: placementStyle(place),
      onBlur: closeOnFocusOut
        ? (e: FocusEvent) => {
            if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close(false);
          }
        : undefined,
    },
    /** Row i of the menu: one roving tabindex across the rows. */
    itemProps: (i: number) => ({
      ref: (el: HTMLButtonElement | null) => {
        itemsRef.current[i] = el;
      },
      tabIndex: i === focusIdx ? 0 : -1,
      onMouseDown: keepFocus,
      onFocus: () => setFocusIdx(i),
    }),
  };
}

export type PopoverMenu = ReturnType<typeof usePopoverMenu>;

/** Run the handler for this key, if the map has one, with the key's default and propagation stopped. */
export function runKey(e: KeyboardEvent, keys: Record<string, () => void>): boolean {
  const k = keys[e.key];
  if (!k) return false;
  e.preventDefault();
  e.stopPropagation();
  k();
  return true;
}

/** The list keys of the font and Styles menus: arrows on either axis move and wrap, Home, End, Escape. */
export function listKeys(m: PopoverMenu, count: number): Record<string, () => void> {
  const move = (to: number) => m.focusItem((to + count) % count, true);
  return {
    ArrowDown: () => move(m.focusIdx + 1),
    ArrowRight: () => move(m.focusIdx + 1),
    ArrowUp: () => move(m.focusIdx - 1),
    ArrowLeft: () => move(m.focusIdx - 1),
    Home: () => move(0),
    End: () => move(count - 1),
    Escape: () => m.close(true),
  };
}
