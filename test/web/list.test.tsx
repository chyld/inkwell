// @vitest-environment happy-dom
// The card list (REDESIGN-BRIEF 2.2): search and a compact New on one row, the view's name under them; each
// note a white rounded card (title and time, one line of snippet, the agent mark, tags); the selected card
// outlined; search results, highlighting, paging, Trash and its Empty Trash control.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { setExpectedUser } from '../../src/web/api';
import { App } from '../../src/web/App';
import { decls } from '../css';
import { button, click, mockFetch, railButton, render, waitFor } from './harness';
const ID = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const item = (n: number, over: Record<string, unknown> = {}) => ({ id: ID(n), title: `Note ${n}`, snippet: `Snippet of note ${n}, long enough to need cutting on one line`, folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' }, ...over });
let pages: Record<string, { notes: unknown[]; nextCursor: string | null }>;
let view: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => {
  setExpectedUser(null);
  sessionStorage.clear();
  localStorage.clear();
  pages = {
    all: { notes: [item(1, { origin: { type: 'agent', name: 'Claude' }, tags: ['idea'] }), item(2)], nextCursor: 'c2' },
    'all&cursor=c2': { notes: [item(3)], nextCursor: null },
    trash: { notes: [item(4, { trashedAt: '2026-01-03T00:00:00Z' })], nextCursor: null },
  };
  mockFetch((method, path, b) => {
    if (method === 'GET' && path === '/api/session') return { status: 200, json: { id: 'u1', username: 'alice' } };
    if (path === '/api/me') return { status: 200, json: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1, inboxId: 'inbox' } };
    if (path === '/api/folders') return { status: 200, json: { folders: [] } };
    if (path === '/api/tags') return { status: 200, json: { tags: [] } };
    if (method === 'POST' && path === '/api/search') return { status: 200, json: { results: [item(2, { title: `Found ${b.query}` })] } };
    const m = /^\/api\/notes\?view=(.*)$/.exec(path);
    if (m && pages[m[1]]) return { status: 200, json: pages[m[1]] };
    if (path.startsWith('/api/notes/') && method === 'GET') return { status: 200, json: { ...item(1), body: { type: 'doc', content: [{ type: 'paragraph' }] }, version: 1 } };
    return { status: 500, json: { error: { code: 'x', message: `unexpected ${method} ${path}` } } };
  });
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function open() {
  view = await render(<App />);
  await waitFor(() => view!.container.querySelectorAll('.note-item').length === 2, 3000, 'list');
  return view.container;
}
const cards = (c: HTMLElement) => [...c.querySelectorAll('#note-list .note-item')] as HTMLElement[];

describe('the list header', () => {
  it('search and a compact New on one row, then the view name; keyboard order search, New, cards', async () => {
    const c = await open();
    const top = c.querySelector('.list-header .list-top')!;
    expect([...top.children].map((e) => e.querySelector('input')?.getAttribute('aria-label') ?? e.getAttribute('aria-label'))).toEqual(['Search notes', 'New note']);
    const nw = c.querySelector('.list-top button[aria-label="New note"]') as HTMLButtonElement; // the rail has one too
    expect(nw.textContent!.trim()).toBe('New');
    expect(nw.classList.contains('primary')).toBe(true);
    expect(nw.title).toMatch(/^New note \((Ctrl\+Alt\+N|⌘⌥N)\)$/);
    expect(c.querySelector('.list-header .list-title h2')!.textContent).toBe('All notes');
    // Focus order follows the DOM: the search box, New, (the list control), then the cards.
    const order = [...c.querySelectorAll('#note-list input, #note-list button')].map((e) => e.getAttribute('aria-label') ?? (e as HTMLElement).className.split(' ')[0]);
    expect(order.slice(0, 3)).toEqual(['Search notes', 'New note', 'Hide note list']);
    expect(order.slice(3, 5)).toEqual(['note-item', 'note-item']);
  });

  it('shows the name of the view: a tag, Trash, and Search results while searching', async () => {
    const c = await open();
    const input = c.querySelector('.search-box input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'plan');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(() => cards(c)[0]?.textContent?.includes('Found plan') ?? false, 3000, 'results');
    const h = c.querySelector('.list-title h2')!;
    expect(h.textContent).toBe('Search results');
    expect(h.getAttribute('title')).toBe('Search results in All notes');
    expect(cards(c)[0].querySelector('.note-title mark')!.textContent).toBe('plan'); // highlighting kept
    expect(button(c, 'Load more')).toBeUndefined(); // no paging in results, as before
  });
});

describe('the cards', () => {
  it('title and time on one line, one line of snippet, the agent mark and tags where they apply', async () => {
    const c = await open();
    const [a, b] = cards(c);
    expect(a.classList.contains('card')).toBe(true);
    expect(a.querySelector('.note-item-top .note-title')!.textContent).toBe('Note 1');
    expect(a.querySelector('.note-item-top time')).toBeTruthy();
    expect(a.querySelectorAll('.note-snippet')).toHaveLength(1);
    expect(a.querySelector('.agent-badge')!.textContent).toBe('by Claude');
    expect(a.querySelector('.tag-chip')!.textContent).toBe('#idea');
    expect(b.querySelector('.agent-badge, .note-meta')).toBeNull();
    // One line of snippet; the selected card visibly outlined (in the focus-ring shade, 3:1 by the theme test).
    expect(decls('.note-snippet')['white-space']).toBe('nowrap');
    expect(decls('.note-item.selected').outline).toBe('2px solid var(--accent-line)');
  });

  it('the selected card is marked; paging adds the next cards', async () => {
    const c = await open();
    await click(cards(c)[1]);
    await waitFor(() => cards(c)[1].classList.contains('selected'), 2000, 'selected');
    expect(cards(c)[1].getAttribute('aria-current')).toBe('true');
    expect(cards(c)[0].classList.contains('selected')).toBe(false);
    await click(button(c, 'Load more'));
    await waitFor(() => cards(c).length === 3, 2000, 'next page');
    expect(cards(c)[2].textContent).toContain('Note 3');
  });
});

describe('Trash', () => {
  it('no search and no New; Empty Trash in the top row; the empty state', async () => {
    const c = await open();
    await click(railButton(c, 'Trash'));
    await waitFor(() => cards(c).length === 1 && cards(c)[0].textContent!.includes('Note 4'), 3000, 'trash');
    expect(c.querySelector('.list-title h2')!.textContent).toBe('Trash');
    expect(c.querySelector('.search-box')).toBeNull();
    expect(c.querySelector('.list-top button[aria-label="New note"]')).toBeNull(); // the rail's stays (DEVIATIONS 48)
    expect(c.querySelector('.list-top')!.contains(button(c, 'Empty Trash')!)).toBe(true);
    pages.trash = { notes: [], nextCursor: null };
    await click(railButton(c, 'All notes'));
    await click(railButton(c, 'Trash'));
    await waitFor(() => /Trash is empty\./.test(c.textContent ?? ''), 3000, 'empty');
    expect(button(c, 'Empty Trash')).toBeUndefined();
  });
});
