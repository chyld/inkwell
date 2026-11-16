// @vitest-environment happy-dom
// The left of the screen: the rail is always shown (it replaced the collapsible folders panel); the note list
// has its own collapse control, a collapsed list leaves a strip that brings it back, the controls say what they
// do and whether the list is open, and the choice is remembered per browser (tolerating a broken localStorage).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setExpectedUser } from '../../src/web/api';
import { App } from '../../src/web/App';
import { LAYOUT_KEY, loadLayout } from '../../src/web/layout';
import { button, click, mockFetch, render, waitFor } from './harness';

let view: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => {
  setExpectedUser(null);
  sessionStorage.clear();
  localStorage.clear();
  mockFetch((method, path) => {
    if (method === 'GET' && path === '/api/session') return { status: 200, json: { id: 'u1', username: 'alice' } };
    if (path === '/api/me') return { status: 200, json: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1, inboxId: 'inbox' } };
    if (path === '/api/folders') return { status: 200, json: { folders: [] } };
    if (path === '/api/tags') return { status: 200, json: { tags: [] } };
    if (path.startsWith('/api/notes?')) return { status: 200, json: { notes: [], nextCursor: null } };
    return { status: 500, json: { error: { code: 'x', message: 'unexpected' } } };
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function open() {
  view = await render(<App />);
  await waitFor(() => !!view!.container.querySelector('#rail'), 3000, 'main screen');
  return view.container;
}
const app = (c: HTMLElement) => c.querySelector('.app')!;
const list = (c: HTMLElement) => c.querySelector('#note-list')!;

// The rail replaced the collapsible folders panel (REDESIGN-BRIEF 2.1): it is always shown and has no
// collapse control. The note list keeps its collapse control and remembered state.
describe('the rail is always shown; the note list collapses', () => {
  it('starts with the rail, the list open, and the list control saying so; no folders-panel control any more', async () => {
    const c = await open();
    expect(c.querySelector('#rail')).toBeTruthy();
    expect(button(c, 'Hide folders and tags')).toBeUndefined();
    expect(button(c, 'Show folders and tags')).toBeUndefined();
    const b = button(c, 'Hide note list')!;
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(b.getAttribute('aria-controls')).toBe('note-list');
    expect(list(c).classList.contains('collapsed')).toBe(false);
    expect(c.querySelector('.panel-strip')).toBeNull();
    expect(app(c).className).not.toMatch(/collapsed/);
  });

  it('a folders panel collapsed under the old layout is ignored: the rail still shows', async () => {
    localStorage.setItem(LAYOUT_KEY, '{"sidebar":true,"list":false}');
    const c = await open();
    expect(c.querySelector('#rail')).toBeTruthy();
    expect(app(c).className).not.toMatch(/sidebar-collapsed/);
    expect(button(c, 'All notes')).toBeTruthy();
  });

  it('collapsing the note list leaves a strip that brings it back, and the focus follows', async () => {
    const c = await open();
    await click(button(c, 'Hide note list'));
    expect(list(c).classList.contains('collapsed')).toBe(true);
    expect(app(c).classList.contains('list-collapsed')).toBe(true);
    const strip = button(c, 'Show note list')!;
    expect(strip.getAttribute('aria-expanded')).toBe('false');
    expect(strip.getAttribute('aria-controls')).toBe('note-list');
    expect(strip.textContent).toContain('All notes'); // the strip says what is hidden
    expect(document.activeElement).toBe(strip);
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!).list).toBe(true);
    await click(strip);
    expect(list(c).classList.contains('collapsed')).toBe(false);
    expect(button(c, 'Show note list')).toBeUndefined();
    expect(document.activeElement).toBe(button(c, 'Hide note list'));
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!).list).toBe(false);
  });

  it('remembers the collapsed list across a reload', async () => {
    let c = await open();
    await click(button(c, 'Hide note list'));
    await view!.unmount();

    c = await open();
    expect(list(c).classList.contains('collapsed')).toBe(true);
    expect(app(c).classList.contains('list-collapsed')).toBe(true);
    expect(button(c, 'Show note list')).toBeTruthy();
    // The collapsed list stays in the page, so the narrow-screen layout (one screen at a time) still has it.
    expect(c.querySelector('#note-list .list-header')).toBeTruthy();
  });

  it('works when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const c = await open();
    expect(list(c).classList.contains('collapsed')).toBe(false);
    await click(button(c, 'Hide note list'));
    expect(list(c).classList.contains('collapsed')).toBe(true);
    await click(button(c, 'Show note list'));
    expect(list(c).classList.contains('collapsed')).toBe(false);
  });

  it('ignores a stored value it does not understand', () => {
    for (const raw of ['not json', 'null', '42', '{"sidebar":"yes","list":1}']) {
      localStorage.setItem(LAYOUT_KEY, raw);
      expect(loadLayout(), raw).toEqual({ sidebar: false, list: false });
    }
    localStorage.setItem(LAYOUT_KEY, '{"sidebar":false,"list":true}');
    expect(loadLayout()).toEqual({ sidebar: false, list: true });
  });
});
