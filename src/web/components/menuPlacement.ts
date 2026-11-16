// Where a toolbar menu opens and how tall it may be, so it never extends past the viewport. Menus are
// position: fixed at the coordinates computed here, so a toolbar that scrolls sideways (phones) does not clip them.
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

/** A menu's viewport position: its left edge, and its top (below the button) or bottom (above it). */
export interface FixedPosition {
  left: number;
  top?: number;
  bottom?: number;
}
export type PlacedMenu = Placement & { fixed?: FixedPosition };

/** Pure: where the menu goes in the viewport for its button's rectangle and its placement. */
export function fixedPosition(button: { top: number; bottom: number; left: number }, p: Placement, viewportHeight: number): FixedPosition {
  return { left: button.left + p.shift, ...(p.above ? { bottom: viewportHeight - button.top + GAP } : { top: button.bottom + GAP }) };
}

/**
 * Recomputed when the menu opens, when `deps` change (its content), when the window is resized and when anything
 * around the button scrolls (the toolbar sideways on a phone), so the menu stays with its button.
 */
export function useMenuPlacement(open: boolean, anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>, deps: unknown[]): PlacedMenu | null {
  const [place, setPlace] = useState<PlacedMenu | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const compute = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const p = menuPlacement(a, menu.current?.offsetWidth ?? 0, { width: window.innerWidth, height: window.innerHeight });
      setPlace({ ...p, fixed: fixedPosition(a, p, window.innerHeight) });
    };
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) compute(); // not the menu's own list
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);
  return place;
}

/** The style a placed menu gets (layout only; no colours). */
export function placementStyle(p: PlacedMenu | null): Record<string, number | string> | undefined {
  if (!p) return undefined;
  if (p.fixed) return { maxHeight: p.maxHeight, left: p.fixed.left, top: p.fixed.top ?? 'auto', bottom: p.fixed.bottom ?? 'auto' };
  return { maxHeight: p.maxHeight, ...(p.shift ? { left: p.shift } : {}) };
}
