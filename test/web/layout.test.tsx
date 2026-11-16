// @vitest-environment happy-dom
// Collapsible left-hand panels: each has its own control, a collapsed panel leaves a strip that
// brings it back, the controls say what they do and whether the panel is open, and the choice
// is remembered per browser across reloads (tolerating a broken localStorage).
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
  await waitFor(() => !!view!.container.querySelector('#sidebar'), 3000, 'main screen');
  return view.container;
}
const app = (c: HTMLElement) => c.querySelector('.app')!;
const sidebar = (c: HTMLElement) => c.querySelector('#sidebar')!;
const list = (c: HTMLElement) => c.querySelector('#note-list')!;

describe('collapsible panels', () => {
  it('starts with both panels open and labelled controls that say so', async () => {
    const c = await open();
    for (const [label, id] of [
      ['Hide folders and tags', 'sidebar'],
      ['Hide note list', 'note-list'],
    ]) {
      const b = button(c, label)!;
      expect(b, label).toBeTruthy();
      expect(b.getAttribute('aria-expanded')).toBe('true');
      expect(b.getAttribute('aria-controls')).toBe(id);
      expect(c.querySelector(`#${id}`)!.classList.contains('collapsed')).toBe(false);
    }
    expect(c.querySelector('.panel-strip')).toBeNull();
    expect(app(c).className).not.toMatch(/collapsed/);
  });

  it('collapsing the folders panel leaves a strip that brings it back, and the focus follows', async () => {
    const c = await open();
    await click(button(c, 'Hide folders and tags'));
    expect(sidebar(c).classList.contains('collapsed')).toBe(true);
    expect(app(c).classList.contains('sidebar-collapsed')).toBe(true);
    expect(list(c).classList.contains('collapsed')).toBe(false); // the other panel is independent
    const strip = button(c, 'Show folders and tags')!;
    expect(strip.getAttribute('aria-expanded')).toBe('false');
    expect(strip.getAttribute('aria-controls')).toBe('sidebar');
    expect(document.activeElement).toBe(strip);
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!)).toEqual({ sidebar: true, list: false });

    await click(strip);
    expect(sidebar(c).classList.contains('collapsed')).toBe(false);
    expect(app(c).classList.contains('sidebar-collapsed')).toBe(false);
    expect(button(c, 'Show folders and tags')).toBeUndefined();
    expect(document.activeElement).toBe(button(c, 'Hide folders and tags'));
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!)).toEqual({ sidebar: false, list: false });
  });

  it('collapsing the note list works on its own too', async () => {
    const c = await open();
    await click(button(c, 'Hide note list'));
    expect(list(c).classList.contains('collapsed')).toBe(true);
    expect(app(c).classList.contains('list-collapsed')).toBe(true);
    expect(sidebar(c).classList.contains('collapsed')).toBe(false);
    const strip = button(c, 'Show note list')!;
    expect(strip.getAttribute('aria-expanded')).toBe('false');
    expect(strip.getAttribute('aria-controls')).toBe('note-list');
    expect(strip.textContent).toContain('All notes'); // the strip says what is hidden
    expect(document.activeElement).toBe(strip);
  });

  it('remembers the collapsed panels across a reload', async () => {
    let c = await open();
    await click(button(c, 'Hide folders and tags'));
    await click(button(c, 'Hide note list'));
    await view!.unmount();

    c = await open();
    expect(sidebar(c).classList.contains('collapsed')).toBe(true);
    expect(list(c).classList.contains('collapsed')).toBe(true);
    expect(app(c).classList.contains('sidebar-collapsed') && app(c).classList.contains('list-collapsed')).toBe(true);
    expect(button(c, 'Show folders and tags')).toBeTruthy();
    expect(button(c, 'Show note list')).toBeTruthy();
    // Collapsed panels stay in the page, so the narrow-screen layout (one panel per screen) still has them.
    expect(c.querySelector('#sidebar .view-button')).toBeTruthy();
    expect(c.querySelector('#note-list .list-header')).toBeTruthy();
  });

  it('works, with everything open, when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const c = await open();
    expect(sidebar(c).classList.contains('collapsed')).toBe(false);
    await click(button(c, 'Hide folders and tags'));
    expect(sidebar(c).classList.contains('collapsed')).toBe(true);
    await click(button(c, 'Show folders and tags'));
    expect(sidebar(c).classList.contains('collapsed')).toBe(false);
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
