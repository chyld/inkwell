// Resizing an image in a note: pure maths (tested on its own) for the node view in ImageView.ts.
// The aspect ratio is always kept; the width stays between IMAGE_MIN_WIDTH and the text column's width.

export const IMAGE_MIN_WIDTH = 40;
/** Keyboard steps in pixels: arrows, Shift+arrows, Page Up / Page Down. */
export const KEY_STEP = 10;
export const KEY_STEP_FINE = 1;
export const KEY_STEP_PAGE = 50;

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export interface Size {
  width: number;
  height: number;
}

/** A width within the limits, in whole pixels. If the column is narrower than the minimum, the column wins. */
export function clampWidth(width: number, maxWidth: number): number {
  const max = Math.max(1, Math.floor(maxWidth));
  return Math.min(max, Math.max(IMAGE_MIN_WIDTH, Math.round(width)));
}

/** The whole-pixel size for a width, keeping the ratio (height / width). */
export function sizeForWidth(width: number, ratio: number, maxWidth: number): Size {
  const w = clampWidth(width, maxWidth);
  return { width: w, height: Math.max(1, Math.round(w * ratio)) };
}

/**
 * The size while dragging a corner: the pointer has moved (dx, dy) from where the drag started. Moving away
 * from the opposite corner grows the image; the axis that moved further (in width terms) decides.
 */
export function dragSize(start: { width: number; ratio: number; corner: Corner; maxWidth: number }, dx: number, dy: number): Size {
  const sx = start.corner.endsWith('right') ? 1 : -1;
  const sy = start.corner.startsWith('bottom') ? 1 : -1;
  const byX = start.width + sx * dx;
  const byY = start.width + (sy * dy) / start.ratio;
  const width = Math.abs(byX - start.width) >= Math.abs(byY - start.width) ? byX : byY;
  return sizeForWidth(width, start.ratio, start.maxWidth);
}

export type KeyResult = { kind: 'size'; size: Size } | { kind: 'reset' } | null;

/**
 * The resize handle's keys: arrows change the width by 10 px (Shift: 1 px), Page Up / Page Down by 50 px,
 * Home to the minimum, End to the column's width, R to the image's own size. Right and Up grow it.
 */
export function keySize(key: string, shift: boolean, current: number, ratio: number, maxWidth: number): KeyResult {
  const step = shift ? KEY_STEP_FINE : KEY_STEP;
  const by: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: KEY_STEP_PAGE, PageDown: -KEY_STEP_PAGE };
  if (key in by) return { kind: 'size', size: sizeForWidth(current + by[key], ratio, maxWidth) };
  if (key === 'Home') return { kind: 'size', size: sizeForWidth(IMAGE_MIN_WIDTH, ratio, maxWidth) };
  if (key === 'End') return { kind: 'size', size: sizeForWidth(maxWidth, ratio, maxWidth) };
  if (key === 'r' || key === 'R') return { kind: 'reset' };
  return null;
}

/** The readout and the handle's spoken value. */
export const sizeText = (s: Size) => `${s.width} × ${s.height}`;
