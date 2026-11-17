// @vitest-environment happy-dom
// The rail (REDESIGN-BRIEF 2.1): icon buttons with names, tooltips and the current mark; the Folders and Tags
// panels (everything the sidebar's folder and tag areas did); the account menu; keyboard order.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { setExpectedUser } from '../../src/web/api';
import { App } from '../../src/web/App';
import { button, click, mockFetch, railButton, render, requests, resetPage, signedInBackend, waitFor } from './harness';

const folder = (id: string, name: string, noteCount: number, children: unknown[] = [], isInbox = false, parentId: string | null = null) => ({ id, name, parentId, isInbox, noteCount, children });
let folders: unknown[];
let signedIn: boolean;
let view: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => {
  setExpectedUser(null);
  sessionStorage.clear();
  localStorage.clear();
  signedIn = true;
  folders = [folder('inbox', 'Inbox', 2, [], true), folder('f1', 'Work', 3, [folder('f2', 'Sub', 1, [], false, 'f1')])];
  mockFetch(
    signedInBackend(
      (method, path, b) => {
        if (method === 'DELETE' && path === '/api/session') {
          signedIn = false;
          return { status: 200, json: { ok: true } };
        }
        if (path === '/api/folders' && method === 'POST') {
          const f = folder('f3', b.name, 0);
          folders = [...folders, f];
          return { status: 201, json: f };
        }
        if (path.startsWith('/api/folders/') && method === 'PATCH') return { status: 200, json: { ok: true } };
        if (path.startsWith('/api/notes?')) return { status: 200, json: { notes: [], nextCursor: null } };
        return { status: 500, json: { error: { code: 'x', message: `unexpected ${method} ${path}` } } };
      },
      {
        signedIn: () => signedIn,
        me: { storageUsed: 12 * 1024 * 1024, storageLimit: 1024 * 1024 * 1024 },
        folders: () => folders,
        tags: [{ name: 'idea', count: 4 }, { name: 'todo', count: 1 }],
      },
    ),
  );
});
afterEach(async () => {
  await resetPage(view);
  view = null;
});

async function open() {
  view = await render(<App />);
  await waitFor(() => !!view!.container.querySelector('#rail') && !!railButton(view!.container, 'Inbox'), 3000, 'rail');
  return view.container;
}
const heading = (c: HTMLElement) => c.querySelector('.list-header h2')!.textContent;
const panel = () => document.querySelector('.rail-panel, .account-menu') as HTMLElement | null;
const escape = (el: Element) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
const outside = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));

describe('the rail', () => {
  it('top: All notes, Inbox, Folders, Tags; bottom: Fonts, Styles, Trash, Account; icons with names and tooltips', async () => {
    const c = await open();
    const groups = [...c.querySelectorAll('#rail .rail-group')].map((g) => [...g.querySelectorAll('.rail-button')].map((b) => b.getAttribute('aria-label')));
    expect(groups).toEqual([
      ['New note', 'All notes', 'Inbox', 'Folders', 'Tags'],
      ['Fonts', 'Styles', 'Trash', 'Account'],
    ]);
    for (const b of c.querySelectorAll('#rail .rail-button')) {
      expect(b.textContent).toBe(''); // icons only
      expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
      expect(b.querySelector('svg.lucide')).toBeTruthy();
    }
    expect(c.querySelector('#rail')!.getAttribute('aria-label')).toBe('Navigation');
    expect(c.querySelector('.sidebar, #sidebar')).toBeNull(); // the sidebar is gone
  });

  it('marks the current view, and the Inbox shows its count to sighted and screen-reader users', async () => {
    const c = await open();
    const current = () => [...c.querySelectorAll('#rail [aria-current]')].map((b) => b.getAttribute('aria-label'));
    expect(current()).toEqual(['All notes']);
    expect(railButton(c, 'All notes').classList.contains('current')).toBe(true);
    await click(railButton(c, 'Inbox'));
    expect(current()).toEqual(['Inbox']);
    expect(heading(c)).toBe('Inbox');
    const badge = c.querySelector('.rail-badge')!;
    expect(badge.textContent).toBe('2');
    expect(railButton(c, 'Inbox').getAttribute('aria-describedby')).toBe(badge.id);
    expect(badge.getAttribute('aria-label')).toBe('2 notes');
    await click(railButton(c, 'Trash'));
    expect(current()).toEqual(['Trash']);
    expect(heading(c)).toBe('Trash');
  });

  it('keyboard order: the rail comes before the list', async () => {
    const c = await open();
    const rail = c.querySelector('#rail')!;
    const list = c.querySelector('#note-list')!;
    expect(rail.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the Folders panel', () => {
  it('holds the tree with counts, Unfiled and New folder; opening moves the focus in; it is a labelled dialog over the list', async () => {
    const c = await open();
    const b = railButton(c, 'Folders');
    expect(b.getAttribute('aria-haspopup')).toBe('dialog');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    await click(b);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    const p = panel()!;
    expect(p.getAttribute('role')).toBe('dialog');
    expect(p.getAttribute('aria-label')).toBe('Folders');
    expect(b.getAttribute('aria-controls')).toBe(p.id);
    expect(p.contains(document.activeElement)).toBe(true);
    expect(p.closest('#rail')).toBeTruthy(); // positioned from the rail, over the list (CSS), not in the grid
    const names = [...p.querySelectorAll('.folder-name')].map((x) => x.textContent);
    expect(names).toEqual(['Work3', 'Sub1']);
    expect(button(p, 'Unfiled')).toBeTruthy();
    expect(button(p, 'New folder')).toBeTruthy();
    expect(p.textContent).not.toContain('Inbox'); // the Inbox is on the rail itself
    // Expand and collapse.
    await click(button(p, 'Collapse'));
    expect([...p.querySelectorAll('.folder-name')].map((x) => x.textContent)).toEqual(['Work3']);
    await click(button(p, 'Expand'));
    expect([...p.querySelectorAll('.folder-name')].length).toBe(2);
    // Each folder's actions.
    await click(button(p, 'Actions for Work'));
    expect([...p.querySelectorAll('.menu [role="menuitem"]')].map((x) => x.textContent)).toEqual(['New subfolder', 'Rename…', 'Move to…', 'Delete…']);
  });

  it('choosing a folder shows it in the list, closes the panel and returns the focus; the rail marks Folders', async () => {
    const c = await open();
    await click(railButton(c, 'Folders'));
    await click([...panel()!.querySelectorAll('.folder-name')].find((x) => x.textContent?.startsWith('Sub')));
    expect(panel()).toBeNull();
    expect(heading(c)).toBe('Sub');
    expect(document.activeElement).toBe(railButton(c, 'Folders'));
    expect(railButton(c, 'Folders').getAttribute('aria-current')).toBe('true');
    expect(railButton(c, 'All notes').getAttribute('aria-current')).toBeNull();
    await click(railButton(c, 'Folders'));
    await click(button(panel()!, 'Unfiled'));
    expect(heading(c)).toBe('Unfiled');
    expect(railButton(c, 'Folders').classList.contains('current')).toBe(true);
  });

  it('Escape closes it and returns the focus; a click outside closes it; its own button toggles it', async () => {
    const c = await open();
    await click(railButton(c, 'Folders'));
    await escape(document.activeElement!);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(railButton(c, 'Folders'));
    await click(railButton(c, 'Folders'));
    await outside(c.querySelector('#note-list')!);
    expect(panel()).toBeNull();
    await click(railButton(c, 'Folders'));
    await click(railButton(c, 'Folders'));
    expect(panel()).toBeNull();
    expect(heading(c)).toBe('All notes'); // nothing was chosen
  });

  it('a dialog opened from the panel (Rename, New folder) does not close it; New folder shows the new folder', async () => {
    const c = await open();
    await click(railButton(c, 'Folders'));
    await click(button(panel()!, 'Actions for Work'));
    await click(button(panel()!, 'Rename…'));
    await waitFor(() => !!document.querySelector('.modal'), 2000, 'rename dialog');
    await outside(document.querySelector('.modal')!); // a click inside the dialog
    expect(panel()).not.toBeNull();
    await click([...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Cancel'));
    expect(panel()).not.toBeNull();
    await click(button(panel()!, 'New folder'));
    await waitFor(() => !!document.querySelector('.modal input'), 2000, 'new folder dialog');
    await act(async () => {
      const input = document.querySelector('.modal input') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Plans');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click([...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'Create'));
    await waitFor(() => heading(c) === 'Plans', 2000, 'new folder shown');
    expect(requests.some((r) => r.method === 'POST' && r.path === '/api/folders' && r.body.name === 'Plans')).toBe(true);
    expect(panel()).toBeNull();
  });
});

describe('the Tags panel', () => {
  it('lists the tags with counts; choosing one shows it, closes the panel and marks Tags', async () => {
    const c = await open();
    await click(railButton(c, 'Tags'));
    const p = panel()!;
    expect(p.getAttribute('aria-label')).toBe('Tags');
    expect([...p.querySelectorAll('.tag-chip')].map((x) => x.textContent)).toEqual(['#idea 4', '#todo 1']);
    await click([...p.querySelectorAll('.tag-chip')][1]);
    expect(panel()).toBeNull();
    expect(heading(c)).toBe('#todo');
    expect(document.activeElement).toBe(railButton(c, 'Tags'));
    expect(railButton(c, 'Tags').getAttribute('aria-current')).toBe('true');
    await click(railButton(c, 'Tags'));
    expect(panel()!.querySelector('.tag-chip[aria-current="page"]')!.textContent).toBe('#todo 1');
  });
});

describe('the account menu', () => {
  it('shows the username and the storage line, and Sign out signs out', async () => {
    const c = await open();
    const b = railButton(c, 'Account');
    await click(b);
    const m = panel()!;
    expect(m.classList.contains('account-menu')).toBe(true);
    expect(m.getAttribute('aria-label')).toBe('Account');
    expect(m.querySelector('.username')!.textContent).toBe('alice');
    expect(m.querySelector('.storage')!.textContent).toBe('12.0 MB of 1.0 GB used');
    expect(document.activeElement).toBe(button(m, 'Sign out'));
    await escape(document.activeElement!);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(b);
    await click(b);
    await click(button(panel()!, 'Sign out'));
    await waitFor(() => /Sign in/.test(c.textContent ?? ''), 3000, 'signed out');
  });
});
