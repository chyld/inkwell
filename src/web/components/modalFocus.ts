// The keyboard focus of a modal (BUGFIX-LIST item 16): into it when it opens, kept inside it while it is open (Tab
// and Shift+Tab wrap), and back to what had it before when it closes. Used by the app's dialogs and the style form.
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

/**
 * `first`: what to focus on open when the modal's own code has not focused something inside it already (by default
 * its first control). Returns the modal box's onKeyDown, which keeps Tab inside.
 */
export function useModalFocus(boxRef: RefObject<HTMLElement | null>, first?: (box: HTMLElement) => HTMLElement | null) {
  const opener = useRef<HTMLElement | null>(null);
  if (opener.current === null && typeof document !== 'undefined') opener.current = document.activeElement as HTMLElement | null;
  useEffect(() => {
    const box = boxRef.current;
    if (box && !box.contains(document.activeElement)) (first?.(box) ?? box.querySelector<HTMLElement>(FOCUSABLE) ?? box).focus();
    return () => {
      const back = opener.current;
      if (back && back !== document.body && back.isConnected) back.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (e: KeyboardEvent) => {
    const box = boxRef.current;
    if (e.key !== 'Tab' || !box) return;
    const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
    e.preventDefault();
    items[next].focus();
  };
}
