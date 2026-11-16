// @vitest-environment happy-dom
// The browser address names the open note (/n/<base62 id>): opening, new note, Back/Forward,
// direct visits and reloads (also signed out, and on a phone), not found, removal, and the
// cross-tab rule that a tab for one user never shows or writes another user's note.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { setExpectedUser } from '../../src/web/api';
import { App } from '../../src/web/App';
import { encodeNoteId } from '../../src/shared/noteAddress';
import { button, click, editorOf, mockFetch, render, requests, settle, waitFor } from './harness';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // in Trash
const BOBS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // belongs to bob
const NEW = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const path = (id: string) => `/n/${encodeNoteId(id)}`;
const item = (id: string, title: string, trashedAt: string | null = null) => ({
  id,
  title,
  snippet: 'x',
  folderId: null,
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  trashedAt,
  origin: { type: 'user' },
});
const body = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const NOTES: Record<string, any> = {
  [A]: { ...item(A, 'Alpha'), body: body('alpha'), version: 1 },
  [B]: { ...item(B, 'Bravo'), body: body('bravo'), version: 1 },
  [T]: { ...item(T, 'Trashed', '2026-01-02T00:00:00Z'), body: body('t'), version: 1 },
};
const users = { u1: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1, inboxId: 'inbox' }, u2: { id: 'u2', username: 'bob', storageUsed: 0, storageLimit: 1, inboxId: 'inbox2' } };

/** A server where the cookie belongs to `cookie` (or nobody); requests for anyone else get 401 wrong_user. */
function server(opts: { cookie: 'u1' | 'u2' | null }) {
  let cookie = opts.cookie;
  mockFetch((method, p, b, headers) => {
    if (method === 'POST' && p === '/api/session') {
      cookie = b.username === 'bob' ? 'u2' : 'u1';
      return { status: 200, json: { id: cookie, username: b.username } };
    }
    if (!cookie) return { status: 401, json: { error: { code: 'unauthorized', message: 'Please sign in.' } } };
    if (method === 'GET' && p === '/api/session') return { status: 200, json: { id: cookie, username: users[cookie].username } };
    if (headers['x-notes-user'] !== cookie) return { status: 401, json: { error: { code: 'wrong_user', message: 'Signed in as someone else.' } } };
    if (method === 'DELETE' && p === '/api/session') {
      cookie = null;
      return { status: 200, json: { ok: true } };
    }
    if (p === '/api/me') return { status: 200, json: users[cookie] };
    if (p === '/api/folders') return { status: 200, json: { folders: [] } };
    if (p === '/api/tags') return { status: 200, json: { tags: [] } };
    if (p.startsWith('/api/notes?view=trash')) return { status: 200, json: { notes: cookie === 'u1' ? [item(T, 'Trashed', '2026-01-02T00:00:00Z')] : [], nextCursor: null } };
    if (p.startsWith('/api/notes?')) return { status: 200, json: { notes: cookie === 'u1' ? [item(A, 'Alpha'), item(B, 'Bravo')] : [item(BOBS, 'Bob only')], nextCursor: null } };
    if (method === 'POST' && p === '/api/notes') return { status: 200, json: { ...item(NEW, ''), version: 1 } };
    const m = /^\/api\/notes\/([0-9a-f-]{36})(\/.*)?$/.exec(p);
    if (m) {
      const owned = cookie === 'u1' ? NOTES[m[1]] ?? (m[1] === NEW ? { ...item(NEW, ''), body: { type: 'doc', content: [{ type: 'paragraph' }] }, version: 1 } : null) : m[1] === BOBS ? { ...item(BOBS, 'Bob only'), body: body('b'), version: 1 } : null;
      if (!owned) return { status: 404, json: { error: { code: 'not_found', message: 'Note not found.' } } };
      if (method === 'GET') return { status: 200, json: owned };
      if (method === 'PUT') return { status: 200, json: { version: (b?.version ?? 1) + 1, updatedAt: '2026-01-03T00:00:00Z' } };
      if (method === 'DELETE') return { status: 200, json: { ok: true } };
      if (method === 'POST') return { status: 200, json: { ok: true } };
    }
    if (method === 'DELETE' && p === '/api/trash') return { status: 200, json: { deleted: 1, deletedIds: [T] } };
    return { status: 500, json: { error: { code: 'x', message: 'unexpected ' + method + ' ' + p } } };
  });
}

let view: Awaited<ReturnType<typeof render>> | null = null;
/** A fresh visit to `p` (a new tab, or a typed/bookmarked address). */
function visit(p: string) {
  history.replaceState(null, '', p);
}
/** What Back/Forward does: the address changes, then popstate. */
async function travel(p: string) {
  await act(async () => {
    history.replaceState({ notes: 1 }, '', p);
    window.dispatchEvent(new PopStateEvent('popstate', { state: { notes: 1 } }));
  });
  await settle();
}
const titleInput = () => view!.container.querySelector('#note-title') as HTMLInputElement | null;
const notFoundText = () => view!.container.querySelector('.not-found')?.textContent ?? '';
const noteGets = (id: string) => requests.filter((r) => r.method === 'GET' && r.path === `/api/notes/${id}`).length;

beforeEach(() => {
  setExpectedUser(null);
  sessionStorage.clear();
  localStorage.clear();
  visit('/');
  document.title = 'Notes';
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function start() {
  view = await render(<App />);
}

describe('note addresses', () => {
  it('opening a note pushes /n/<id>; the page title follows the note title; a new note moves to its address', async () => {
    server({ cookie: 'u1' });
    await start();
    await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'list');
    const len = history.length;
    await click([...view!.container.querySelectorAll('.note-item')].find((b) => b.textContent?.includes('Alpha')));
    await waitFor(() => titleInput()?.value === 'Alpha', 3000, 'Alpha open');
    expect(location.pathname).toBe(path(A));
    expect(history.length).toBe(len + 1);
    expect(document.title).toBe('Alpha – Notes');
    await act(async () => {
      const el = titleInput()!;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(el, 'Alpha renamed');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(() => document.title === 'Alpha renamed – Notes', 2000, 'title follows edits');

    await click(button(view!.container, 'New note'));
    await waitFor(() => location.pathname === path(NEW), 3000, 'new note address');
    expect(history.length).toBe(len + 2);
    await waitFor(() => document.title === 'Untitled – Notes', 2000, 'untitled');
  });

  it('Back and Forward move between opened notes and the list, flushing edits like a click, without new entries', async () => {
    server({ cookie: 'u1' });
    await start();
    await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'list');
    await click([...view!.container.querySelectorAll('.note-item')].find((b) => b.textContent?.includes('Alpha')));
    await waitFor(() => titleInput()?.value === 'Alpha', 3000, 'Alpha');
    await click([...view!.container.querySelectorAll('.note-item')].find((b) => b.textContent?.includes('Bravo')));
    await waitFor(() => titleInput()?.value === 'Bravo', 3000, 'Bravo');
    const len = history.length;

    // An unsaved edit in Bravo, then Back to Alpha: Bravo is saved first, as when clicking another note.
    await act(async () => {
      editorOf(view!.container).commands.insertContent(' edited');
    });
    await travel(path(A));
    await waitFor(() => titleInput()?.value === 'Alpha', 3000, 'back to Alpha');
    const putB = requests.findIndex((r) => r.method === 'PUT' && r.path === `/api/notes/${B}`);
    const lastGetA = requests.map((r) => r.method + r.path).lastIndexOf(`GET/api/notes/${A}`);
    expect(putB).toBeGreaterThanOrEqual(0);
    expect(putB).toBeLessThan(lastGetA);
    expect(JSON.stringify(requests[putB].body)).toContain('edited');

    // Back to the list: no note open, title back to the app's.
    await travel('/');
    await waitFor(() => !titleInput(), 3000, 'closed');
    expect(view!.container.querySelector('.editor-pane.empty')?.textContent).toContain('Select a note');
    expect(document.title).toBe('Notes');
    // Forward again.
    await travel(path(A));
    await waitFor(() => titleInput()?.value === 'Alpha', 3000, 'forward to Alpha');
    expect(history.length).toBe(len); // history travel adds no entries
  });

  it('a direct visit or reload of /n/<id> opens the note, with "/" underneath for Back; on a phone it shows the editor', async () => {
    server({ cookie: 'u1' });
    visit(path(B));
    const len = history.length;
    await start();
    await waitFor(() => titleInput()?.value === 'Bravo', 3000, 'Bravo from the address');
    expect(view!.container.querySelector('.app')!.classList.contains('screen-editor')).toBe(true);
    expect(location.pathname).toBe(path(B));
    expect(history.length).toBe(len + 1); // "/" was put underneath
    expect(history.state).toEqual({ notes: 1 });
    // A reload keeps the history as it is.
    await view!.unmount();
    await start();
    await waitFor(() => titleInput()?.value === 'Bravo', 3000, 'Bravo after reload');
    expect(history.length).toBe(len + 1);
    // The phone's in-app Back closes the note and returns to the list.
    await click(button(view!.container, 'Back to list'));
    await waitFor(() => location.pathname === '/', 2000, 'address /');
    expect(view!.container.querySelector('.app')!.classList.contains('screen-list')).toBe(true);
  });

  it('opens a note in Trash from its address, shown as Trash notes are', async () => {
    server({ cookie: 'u1' });
    visit(path(T));
    await start();
    await waitFor(() => titleInput()?.value === 'Trashed', 3000, 'trashed note');
    expect(view!.container.querySelector('.banner')?.textContent).toContain('This note is in Trash');
    expect(titleInput()!.readOnly).toBe(true);
  });

  it("a malformed id, a missing note and another user's note all say 'not found', once, with a way back", async () => {
    server({ cookie: 'u1' });
    for (const p of ['/n/short', '/n/' + 'z'.repeat(22), '/n/a/b', path('99999999-9999-4999-8999-999999999999'), path(BOBS)]) {
      visit(p);
      requests.length = 0;
      await start();
      await waitFor(() => notFoundText().includes('This note was not found'), 3000, 'not found for ' + p);
      expect(document.title).toBe('Note not found – Notes');
      await settle();
      // No loop: at most one request for the note, and the address is left alone.
      expect(requests.filter((r) => r.path.startsWith('/api/notes/')).length).toBeLessThanOrEqual(1);
      expect(location.pathname).toBe(p.replace(/\/$/, ''));
      await view!.unmount();
      view = null;
    }
    // Same wording for "does not exist" and "someone else's".
    visit(path(BOBS));
    await start();
    await waitFor(() => notFoundText().length > 0, 3000, 'not found');
    const forOther = notFoundText();
    await view!.unmount();
    visit(path('99999999-9999-4999-8999-999999999999'));
    await start();
    await waitFor(() => notFoundText().length > 0, 3000, 'not found');
    expect(notFoundText()).toBe(forOther);
    // "Go to all notes" replaces the bad address with "/".
    const len = history.length;
    await click(button(view!.container, 'Go to all notes'));
    await waitFor(() => location.pathname === '/', 2000, 'back to /');
    expect(history.length).toBe(len);
    expect(view!.container.querySelector('.not-found')).toBeNull();
    expect(view!.container.querySelector('.list-header h2')?.textContent).toBe('All notes');
  });

  it('signed out: the sign-in page appears, and after sign-in the note from the address opens', async () => {
    server({ cookie: null });
    visit(path(A));
    await start();
    await waitFor(() => !!view!.container.querySelector('input[autocomplete="username"], #username, input[name="username"]') || /Sign in/.test(view!.container.textContent ?? ''), 3000, 'sign-in page');
    expect(noteGets(A)).toBe(0);
    const inputs = view!.container.querySelectorAll('input');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(inputs[0], 'alice');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      set.call(inputs[1], 'correct horse battery');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button(view!.container, 'Sign in'));
    await waitFor(() => titleInput()?.value === 'Alpha', 3000, 'note opens after sign-in');
    expect(location.pathname).toBe(path(A));
  });

  it("cross-tab: a tab for alice opened on her note while the cookie is bob's shows the sign-in page, never his data", async () => {
    server({ cookie: 'u2' });
    sessionStorage.setItem('notes:tab-user', 'u1'); // this tab signed in as alice earlier (reload)
    visit(path(A));
    await start();
    await waitFor(() => /Sign in/.test(view!.container.textContent ?? '') && !view!.container.querySelector('.app'), 3000, 'sign-in page');
    expect(requests.filter((r) => r.method !== 'GET' || r.path.startsWith('/api/notes')).every((r) => r.headers['x-notes-user'] === 'u1')).toBe(true);
    expect(titleInput()).toBeNull();
    expect(requests.some((r) => r.method === 'PUT' || r.method === 'POST' && r.path !== '/api/session')).toBe(false);
    expect(location.pathname).toBe(path(A)); // kept, so alice gets her note after signing in again
  });

  it("cross-tab: a new tab whose cookie is bob's, opened on alice's note address, says not found", async () => {
    server({ cookie: 'u2' });
    visit(path(A));
    await start();
    await waitFor(() => notFoundText().includes('This note was not found'), 3000, 'not found');
    expect(requests.find((r) => r.path === `/api/notes/${A}`)?.headers['x-notes-user']).toBe('u2');
    expect(titleInput()).toBeNull();
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it('moving to Trash, deleting permanently and emptying Trash return the address to /', async () => {
    server({ cookie: 'u1' });
    visit(path(A));
    await start();
    await waitFor(() => titleInput()?.value === 'Alpha', 3000, 'Alpha');
    await click(button(view!.container, 'Move to Trash'));
    await waitFor(() => location.pathname === '/', 3000, '/ after Trash');

    await view!.unmount();
    visit(path(T));
    await start();
    await waitFor(() => titleInput()?.value === 'Trashed', 3000, 'trashed');
    await click(button(view!.container, 'Delete permanently'));
    await waitFor(() => !!document.querySelector('.modal'), 2000, 'confirm');
    await click([...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Delete permanently'));
    await waitFor(() => location.pathname === '/', 3000, '/ after delete');

    await view!.unmount();
    visit(path(T));
    await start();
    await waitFor(() => titleInput()?.value === 'Trashed', 3000, 'trashed again');
    await click([...view!.container.querySelectorAll('.view-button')].find((b) => b.textContent?.includes('Trash')));
    await waitFor(() => !!button(view!.container, 'Empty Trash'), 3000, 'Empty Trash button');
    await click(button(view!.container, 'Empty Trash'));
    await waitFor(() => !!document.querySelector('.modal'), 2000, 'confirm');
    await click([...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Empty Trash'));
    await waitFor(() => location.pathname === '/', 3000, '/ after Empty Trash');
  });

  it('signing out returns the address to /', async () => {
    server({ cookie: 'u1' });
    visit(path(A));
    await start();
    await waitFor(() => titleInput()?.value === 'Alpha', 3000, 'Alpha');
    await click(button(view!.container, 'Sign out'));
    await waitFor(() => location.pathname === '/', 3000, '/ after sign-out');
  });
});
