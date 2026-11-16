// @vitest-environment happy-dom
// Icons: every icon in the web UI is a lucide line icon (no emoji or text glyphs), and every
// icon-only button still has an accessible label and a tooltip.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { setExpectedUser } from '../../src/web/api';
import { App } from '../../src/web/App';
import { button, click, editorOf, mockFetch, railButton, render, waitFor } from './harness';

const NOTE = '66666666-6666-4666-8666-666666666666';
const item = { id: NOTE, title: 'Iconic', snippet: 'x', folderId: 'f1', tags: ['t'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } };
const note = { ...item, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }, version: 1 };
const folder = (id: string, name: string, children: unknown[] = [], isInbox = false) => ({ id, name, parentId: null, isInbox, noteCount: 1, children });

// Emoji, arrows, bullets, dingbats and the old text stand-ins (« » ‹ × ⋯ ▾ ▸ ― ❝ …).
const GLYPHS = /[←-⯿\u{1F000}-\u{1FFFF}•«»×‹›−―…⋯❝]/u;
const OLD_LABELS = new Set(['+', 'B', 'I', 'S', '</>', 'H1', 'H2', 'H3', '1.', '{ }', 'Header', '+ New note']);

let view: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => {
  setExpectedUser(null);
  sessionStorage.clear();
  localStorage.clear();
  mockFetch((method, path) => {
    if (method === 'GET' && path === '/api/session') return { status: 200, json: { id: 'u1', username: 'alice' } };
    if (path === '/api/me') return { status: 200, json: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1, inboxId: 'inbox' } };
    if (path === '/api/folders') return { status: 200, json: { folders: [folder('inbox', 'Inbox', [], true), folder('f1', 'Work', [folder('f2', 'Sub')])] } };
    if (path === '/api/tags') return { status: 200, json: { tags: [{ name: 't', count: 1 }] } };
    if (path.startsWith('/api/notes?')) return { status: 200, json: { notes: [item], nextCursor: null } };
    if (path === `/api/notes/${NOTE}` && method === 'GET') return { status: 200, json: note };
    if (method === 'PUT') return { status: 200, json: { version: 2, updatedAt: '2026-01-02T00:00:00Z' } };
    return { status: 500, json: { error: { code: 'x', message: 'unexpected' } } };
  });
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

function checkButtons(root: ParentNode) {
  const buttons = [...root.querySelectorAll('button')];
  expect(buttons.length).toBeGreaterThan(5);
  for (const b of buttons) {
    const text = (b.textContent ?? '').trim();
    const name = b.getAttribute('aria-label') ?? text;
    expect(GLYPHS.test(text), `glyph in button "${name}": ${text}`).toBe(false);
    expect(OLD_LABELS.has(text), `old text icon in button "${name}": ${text}`).toBe(false);
    for (const svg of b.querySelectorAll('svg')) {
      expect(svg.classList.contains('lucide'), `non-lucide icon in "${name}"`).toBe(true);
      expect(svg.getAttribute('aria-hidden'), `icon in "${name}" is hidden from screen readers`).toBe('true');
    }
    if (!text) {
      // Icon only: it must say what it does, to screen readers and as a tooltip.
      expect(b.getAttribute('aria-label'), `unlabelled icon button ${b.outerHTML.slice(0, 80)}`).toBeTruthy();
      expect(b.getAttribute('title'), `no tooltip on "${name}"`).toBeTruthy();
      expect(b.querySelector('svg.lucide'), `icon-only button "${name}" has an icon`).toBeTruthy();
    }
  }
}

describe('icons', () => {
  it('the main screen, editor, toolbar and table tools use labelled lucide icons only', async () => {
    view = await render(<App />);
    await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'list');
    await click(view.container.querySelector('.note-item'));
    await waitFor(() => !!editorOf(view!.container), 3000, 'editor');
    await act(async () => {
      editorOf(view!.container).chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    });
    await waitFor(() => !!view!.container.querySelector('.table-tools'), 2000, 'table tools');
    checkButtons(document);
    for (const [label, icon] of [
      ['Headings', 'lucide-letter-h'], // lucide's Heading icon
      ['Lists', 'lucide-list'],
      ['Blocks', 'lucide-text-quote'],
      ['Insert', 'lucide-plus'],
      ['Bold', 'lucide-bold'],
      ['Move to Trash', 'lucide-trash-2'],
    ]) {
      expect(button(view.container, label)?.querySelector(`svg.${icon}`), label).toBeTruthy();
    }
    // The block dropdowns' rows: icon and label, each a labelled lucide icon too.
    for (const [menu, rows] of [
      ['Headings', [['Normal text', 'lucide-pilcrow'], ['Heading 1', 'lucide-heading-1'], ['Heading 2', 'lucide-heading-2'], ['Heading 3', 'lucide-heading-3']]],
      ['Insert', [['Horizontal line', 'lucide-minus'], ['Table', 'lucide-table'], ['Image', 'lucide-image-plus']]],
    ] as const) {
      await click(button(view.container, menu));
      for (const [label, icon] of rows) expect(button(document, label)?.querySelector(`svg.${icon}`), label).toBeTruthy();
      checkButtons(document);
      // Active and disabled states are on the rows themselves: inside a table, Insert › Table is disabled.
      if (menu === 'Insert') expect(button(document, 'Table')!.disabled).toBe(true);
      await click(button(view.container, menu));
    }
    expect(button(view.container, 'Bold')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('the rail, its panels and account menu, the collapsed-list strip and the folder picker dialog too', async () => {
    view = await render(<App />);
    await waitFor(() => !!view!.container.querySelector('.note-item'), 3000, 'list');
    // The rail: icon-only buttons, each named and with a tooltip (checkButtons), and its panels.
    for (const [label, icon] of [
      ['All notes', 'lucide-notebook'],
      ['Inbox', 'lucide-inbox'],
      ['Folders', 'lucide-folder'],
      ['Tags', 'lucide-tag'],
      ['Fonts', 'lucide-type'],
      ['Styles', 'lucide-paintbrush'],
      ['Trash', 'lucide-trash-2'],
      ['Account', 'lucide-circle-user'],
    ]) {
      expect(railButton(view.container, label)?.querySelector(`svg.${icon}`), label).toBeTruthy();
    }
    for (const panel of ['Folders', 'Tags', 'Account']) {
      await click(railButton(view.container, panel));
      checkButtons(document);
      await click(railButton(view.container, panel));
    }
    await click(button(view.container, 'Hide note list'));
    await click(button(view.container, 'Show note list'));
    await click(view.container.querySelector('.note-item'));
    await waitFor(() => !!button(view!.container, 'Move to…'), 3000, 'editor');
    await click(button(view.container, 'Move to…'));
    await waitFor(() => !!document.querySelector('.folder-picker'), 2000, 'picker');
    expect(document.querySelectorAll('.folder-picker svg.lucide').length).toBeGreaterThanOrEqual(4); // Unfiled, Inbox, Work, Sub
    checkButtons(document);
  });
});
