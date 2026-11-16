// The /fonts grid's row arithmetic (FONTS-SPEC 7): one fixed row height, and a column count that
// depends only on the grid's width (one column at 390 px). Pure, so tests can state a viewport.
export const ROW_HEIGHT = 92;
export const CARD_MIN_WIDTH = 220;
export const GRID_GAP = 12;

export function columnsFor(gridWidth: number): number {
  return Math.max(1, Math.floor((gridWidth + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)));
}

export interface RowRange {
  columns: number;
  rowCount: number;
  /** First and last rendered row (inclusive); last < first when nothing is rendered. */
  first: number;
  last: number;
}

/**
 * The rows to render: those intersecting the viewport extended by one viewport height above and
 * below. `scrollTop` is measured from the top of the grid.
 */
export function rowsToRender(scrollTop: number, viewportHeight: number, gridWidth: number, itemCount: number): RowRange {
  const columns = columnsFor(gridWidth);
  const rowCount = Math.ceil(itemCount / columns);
  if (rowCount === 0 || viewportHeight <= 0) return { columns, rowCount, first: 0, last: -1 };
  const top = scrollTop - viewportHeight;
  const bottom = scrollTop + 2 * viewportHeight;
  const first = Math.max(0, Math.floor(top / ROW_HEIGHT));
  const last = Math.min(rowCount - 1, Math.ceil(bottom / ROW_HEIGHT) - 1);
  return { columns, rowCount, first, last };
}
