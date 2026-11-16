// @vitest-environment happy-dom
// CLEANUP-PLAN pass 1 item 1: the browser no longer fetches /me after every save, upload, new note or delete.
// The account menu fetches it when it opens, and shows the fresh storage line.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { setExpectedUser } from '../../src/web/api';
import { App } from '../../src/web/App';
import { click, editorOf, mockFetch, railButton, render, requests, waitFor } from './harness';

const NOTE = '55555555-5555-4555-8555-555555555555';
const item = { id: NOTE, title: 'Draft', snippet: 'x', folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } };
let used = 1000;
let version = 1;
let view: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => {
  setExpectedUser(null);
  sessionStorage.clear();
  localStorage.clear();
  used = 1000;
  version = 1;
  mockFetch((method, path) => {
    if (method === 'GET' && path === '/api/session') return { status: 200, json: { id: 'u1', username: 'alice' } };
    if (path === '/api/me') return { status: 200, json: { id: 'u1', username: 'alice', storageUsed: used, storageLimit: 1024 * 1024 * 1024, inboxId: 'inbox' } };
    if (path === '/api/folders') return { status: 200, json: { folders: [] } };
    if (path === '/api/tags') return { status: 200, json: { tags: [] } };
    if (path.startsWith('/api/notes?')) return { status: 200, json: { notes: [item], nextCursor: null } };
    if (path === `/api/notes/${NOTE}` && method === 'GET') return { status: 200, json: { ...item, body: { type: 'doc', content: [{ type: 'paragraph' }] }, version } };
    if (path === `/api/notes/${NOTE}` && method === 'PUT') {
      used += 50; // the save grew the note
      return { status: 200, json: { version: ++version, updatedAt: '2026-01-02T00:00:00Z' } };
    }
    return { status: 500, json: { error: { code: 'x', message: `unexpected ${method} ${path}` } } };
  });
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

const meRequests = () => requests.filter((r) => r.method === 'GET' && r.path === '/api/me').length;
const puts = () => requests.filter((r) => r.method === 'PUT').length;

describe('/me requests', () => {
  it('none after saves; one each time the account menu opens, whose storage line is then current', async () => {
    view = await render(<App />);
    await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'list');
    const atStart = meRequests(); // the sign-in check
    expect(atStart).toBe(1);
    await click(view.container.querySelector('.note-item'));
    await waitFor(() => !!editorOf(view!.container), 3000, 'editor');
    for (const text of ['one', ' two', ' three']) {
      const before = puts();
      await act(async () => void editorOf(view!.container).commands.insertContent(text));
      await waitFor(() => puts() > before, 4000, 'save');
    }
    expect(puts()).toBe(3);
    expect(meRequests()).toBe(atStart); // before this change: one more per save
    await click(railButton(view.container, 'Account'));
    await waitFor(() => meRequests() === atStart + 1, 2000, 'fetched on open');
    await waitFor(() => /1\.1 KB of 1\.0 GB used/.test(document.querySelector('.account-menu .storage')?.textContent ?? ''), 2000, 'fresh storage line');
    await click(railButton(view.container, 'Account')); // its own button closes it
    await click(railButton(view.container, 'Account'));
    await waitFor(() => meRequests() === atStart + 2, 2000, 'fetched on the next open');
  });
});
