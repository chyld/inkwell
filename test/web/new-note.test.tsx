// @vitest-environment happy-dom
// BUGFIX-LIST item 18: a held Ctrl+Alt+N, or New pressed again while a note is being made, makes one note.
// BUGFIX-LIST item 20: a new note made from a tag view is not listed there (it has no tags).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { setExpectedUser } from '../../src/web/api';
import { App } from '../../src/web/App';
import { click, mockFetch, railButton, render, requests, resetPage, settle, signedInBackend, waitFor } from './harness';

const NEW = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`;
const item = (id: string, title: string, tags: string[] = []) => ({ id, title, snippet: 'x', folderId: null, tags, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } });
let made = 0;
let holdPost: Promise<void> | null = null;
let view: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(() => {
  setExpectedUser(null);
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  made = 0;
  holdPost = null;
  mockFetch(
    signedInBackend(
      async (method, p) => {
        if (method === 'POST' && p === '/api/notes') {
          await holdPost;
          return { status: 201, json: { ...item(NEW(++made), ''), version: 1 } };
        }
        if (p.startsWith('/api/notes?view=tag')) return { status: 200, json: { notes: [item('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Tagged', ['work'])], nextCursor: null } };
        if (p.startsWith('/api/notes?')) return { status: 200, json: { notes: [], nextCursor: null } };
        const one = /^\/api\/notes\/([0-9a-f-]{36})$/.exec(p);
        if (method === 'GET' && one) return { status: 200, json: { ...item(one[1], ''), body: { type: 'doc', content: [{ type: 'paragraph' }] }, version: 1 } };
        if (p === '/api/styles') return { status: 200, json: [] };
        return { status: 404, json: { error: { code: 'x', message: `unexpected ${method} ${p}` } } };
      },
      { tags: [{ name: 'work', count: 1 }] },
    ),
  );
});
afterEach(async () => {
  await resetPage(view);
  view = null;
});

const posts = () => requests.filter((r) => r.method === 'POST' && r.path === '/api/notes').length;
const shortcut = (repeat: boolean) =>
  act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true, repeat, bubbles: true, cancelable: true })));
const listTitles = () => [...view!.container.querySelectorAll('#note-list .note-item')].map((x) => x.textContent ?? '');
async function start() {
  view = await render(<App />);
  await waitFor(() => !!railButton(view!.container, 'New note'), 4000, 'the app');
  await settle();
}

describe('one new note at a time (BUGFIX-LIST item 18)', () => {
  it('a held Ctrl+Alt+N (key repeat) makes one note', async () => {
    await start();
    await shortcut(false);
    await waitFor(() => location.pathname.startsWith('/n/'), 3000, 'the new note open');
    for (let i = 0; i < 5; i++) await shortcut(true);
    await settle();
    expect(posts()).toBe(1); // before: 6
  });

  it('New pressed twice (or the shortcut again) while the first is being made: one note', async () => {
    let release!: () => void;
    holdPost = new Promise((r) => (release = r));
    await start();
    await click(railButton(view!.container, 'New note'));
    await click(railButton(view!.container, 'New note'));
    await shortcut(false);
    await act(async () => release());
    await settle();
    await settle();
    expect(posts()).toBe(1); // before: 3
    expect(made).toBe(1);
    // And afterwards New works again.
    await click(railButton(view!.container, 'New note'));
    await waitFor(() => posts() === 2, 3000, 'a second note');
  });
});

describe('a new note in a tag view (BUGFIX-LIST item 20)', () => {
  it('is opened, but not listed under the tag it does not have', async () => {
    await start();
    await click(railButton(view!.container, 'Tags'));
    await click(document.querySelector('.rail-panel .tag-chip'));
    await waitFor(() => view!.container.querySelector('.list-header h2')?.textContent === '#work', 3000, 'the #work view');
    await waitFor(() => view!.container.querySelectorAll('#note-list .note-item').length === 1, 3000, 'its note');
    await click(railButton(view!.container, 'New note'));
    await waitFor(() => location.pathname.startsWith('/n/'), 3000, 'the new note open');
    await settle();
    expect(view!.container.querySelector('.list-header h2')?.textContent).toBe('#work');
    expect(listTitles()).toHaveLength(1); // before: 2, the new note listed
    expect(listTitles()[0]).toContain('Tagged');
  });
});
