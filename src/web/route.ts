// The browser address: "/" for the app with no note open, "/n/<base62 id>" for an open note.
import { decodeNoteId, notePath } from '../shared/noteAddress';

export type Route = { kind: 'list' } | { kind: 'note'; id: string } | { kind: 'notFound' } | { kind: 'fonts' } | { kind: 'styles' };

export function routeOf(pathname: string): Route {
  if (pathname === '/fonts' || pathname === '/fonts/') return { kind: 'fonts' };
  if (pathname === '/styles' || pathname === '/styles/') return { kind: 'styles' };
  if (pathname.startsWith('/n/')) {
    const m = /^\/n\/([^/]+)\/?$/.exec(pathname);
    const id = m ? decodeNoteId(m[1]) : null;
    return id ? { kind: 'note', id } : { kind: 'notFound' };
  }
  return { kind: 'list' }; // "/" (and any other path the server answers with the app)
}

export function currentRoute(): Route {
  return routeOf(window.location.pathname);
}

/** Entries this app wrote carry this state, so a reload can tell them from a fresh visit. */
const MARK = { notes: 1 };

/** Point the address at `path`: a new history entry ('push') or in place ('replace'). */
export function setAddress(path: string, mode: 'push' | 'replace') {
  if (window.location.pathname === path && window.history.state?.notes === 1) return;
  if (mode === 'push' && window.location.pathname !== path) window.history.pushState(MARK, '', path);
  else window.history.replaceState(MARK, '', path);
}

/**
 * On a fresh visit straight to a note's address, put "/" underneath it in the history, so Back
 * returns to the list with no note open instead of leaving the app. Any other path becomes "/".
 * A reload keeps the history as it is.
 */
export function initHistory() {
  if (window.history.state?.notes === 1) return;
  const path = window.location.pathname;
  const r = routeOf(path);
  window.history.replaceState(MARK, '', '/');
  if (r.kind !== 'list') window.history.pushState(MARK, '', path);
}

export { notePath };

export const APP_TITLE = 'Inkwell';
export function noteTitle(title: string): string {
  return `${title.trim() || 'Untitled'} – ${APP_TITLE}`;
}
export const NOT_FOUND_TITLE = `Note not found – ${APP_TITLE}`;
export const FONTS_TITLE = `Fonts – ${APP_TITLE}`;
export const STYLES_TITLE = `Styles – ${APP_TITLE}`;
