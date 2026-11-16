// Which of the two left-hand panels (folders and tags, the note list) are collapsed.
// Remembered per browser in localStorage; every storage failure is tolerated.
export interface Layout {
  sidebar: boolean;
  list: boolean;
}

export const LAYOUT_KEY = 'notes:layout';
const OPEN: Layout = { sidebar: false, list: false };

export function loadLayout(): Layout {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_KEY);
    if (!raw) return OPEN;
    const v = JSON.parse(raw);
    return { sidebar: v?.sidebar === true, list: v?.list === true };
  } catch {
    return OPEN;
  }
}

export function saveLayout(l: Layout) {
  try {
    globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify({ sidebar: l.sidebar, list: l.list }));
  } catch {
    /* tolerated: the layout is then remembered only until the page is reloaded */
  }
}
