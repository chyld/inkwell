// Whether the note list is collapsed (wide screens only). Remembered per browser in localStorage; every
// storage failure is tolerated. A stored value from the old sidebar is ignored.
export interface Layout {
  list: boolean;
}

export const LAYOUT_KEY = 'notes:layout';
const OPEN: Layout = { list: false };

export function loadLayout(): Layout {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_KEY);
    if (!raw) return OPEN;
    const v = JSON.parse(raw);
    return { list: v?.list === true };
  } catch {
    return OPEN;
  }
}

export function saveLayout(l: Layout) {
  try {
    globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify({ list: l.list }));
  } catch {
    /* tolerated: the layout is then remembered only until the page is reloaded */
  }
}
