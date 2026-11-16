// Where a toolbar menu opens and how tall it may be, so it never extends past the viewport.
import { useLayoutEffect, useState, type RefObject } from 'react';

export const MENU_MAX_HEIGHT = 420;
/** Below this much room under the button, the menu opens above it if there is more room there. */
export const MENU_MIN_HEIGHT = 160;
const GAP = 4; // between the button and the menu
const MARGIN = 8; // from the viewport's edges

export interface Placement {
  maxHeight: number;
  above: boolean;
  /** Horizontal shift (≤ 0) that keeps the menu inside the viewport. */
  shift: number;
}

/** Pure: the menu's placement for its button's rectangle, its own width and the viewport. */
export function menuPlacement(button: { top: number; bottom: number; left: number }, menuWidth: number, viewport: { width: number; height: number }): Placement {
  const below = viewport.height - button.bottom - GAP - MARGIN;
  const aboveRoom = button.top - GAP - MARGIN;
  const above = below < MENU_MIN_HEIGHT && aboveRoom > below;
  const maxHeight = Math.max(0, Math.min(MENU_MAX_HEIGHT, above ? aboveRoom : below));
  const overflow = button.left + menuWidth - (viewport.width - MARGIN);
  const shift = overflow > 0 ? -Math.min(overflow, Math.max(0, button.left - MARGIN)) : 0;
  return { maxHeight, above, shift };
}

/** Recomputed when the menu opens, when `deps` change (its content) and when the window is resized. */
export function useMenuPlacement(open: boolean, anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>, deps: unknown[]): Placement | null {
  const [place, setPlace] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const compute = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      setPlace(menuPlacement(a, menu.current?.offsetWidth ?? 0, { width: window.innerWidth, height: window.innerHeight }));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);
  return place;
}

/** The style a placed menu gets (layout only; no colours). */
export function placementStyle(p: Placement | null): Record<string, number> | undefined {
  if (!p) return undefined;
  return { maxHeight: p.maxHeight, ...(p.shift ? { left: p.shift } : {}) };
}
