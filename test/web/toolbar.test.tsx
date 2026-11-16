// @vitest-environment happy-dom
// The editor toolbar (DEVIATIONS 45): the block dropdowns (Headings, Lists, Blocks, Insert), their contents,
// actions and toggling, the button icon following the cursor, checked rows, the keyboard, disabled states,
// and the old keyboard shortcuts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import { DialogProvider } from '../../src/web/components/Dialogs';
import { NoteEditorPane } from '../../src/web/components/NoteEditor';
import { clearAllFonts, setFaceLoader } from '../../src/web/fonts/runtime';
import { PreviewLoader, setPreviewLoader } from '../../src/web/fonts/previews';
import { resetStyles } from '../../src/web/stylesStore';
import { button, click, editorOf, mockFetch, render, waitFor } from './harness';
import { HASH, installFontEnv } from './fonts-env';

const NOTE_ID = '88888888-8888-4888-8888-888888888888';
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...c: unknown[]) => ({ type: 'paragraph', content: c });
const props = { noteId: NOTE_ID, me: { id: 'u1', username: 'alice', storageUsed: 0, storageLimit: 1 << 30, inboxId: 'inbox' }, folders: [], allTags: [], autoFocusTitle: false, onMeta: vi.fn(), onTrashed: vi.fn(), onRestored: vi.fn(), onDeleted: vi.fn(), onTagsChanged: vi.fn(), onStorageChanged: vi.fn(), onBack: vi.fn(), onBrowseFonts: vi.fn(), onManageStyles: vi.fn() };

let view: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => {
  installFontEnv();
  clearAllFonts();
  setFaceLoader(null);
  setPreviewLoader(new PreviewLoader({ fetchPreview: async () => HASH(9), now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms) }));
  localStorage.clear();
  resetStyles();
});
afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

async function open(content: unknown[]) {
  let stored: any = { type: 'doc', content };
  mockFetch((method, path, b) => {
    if (method === 'GET' && path === `/api/notes/${NOTE_ID}`) return { status: 200, json: { id: NOTE_ID, title: 'Bar', body: stored, version: 3, folderId: null, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', trashedAt: null, origin: { type: 'user' } } };
    if (method === 'PUT') {
      stored = b.body;
      return { status: 200, json: { version: (b?.version ?? 0) + 1, updatedAt: '2026-01-02T00:00:00Z' } };
    }
    if (path === '/api/styles') return { status: 200, json: [] };
    if (path === '/api/fonts/collection') return { status: 200, json: [] };
    return { status: 404, json: { error: { code: 'x', message: 'x' } } };
  });
  view = await render(
    <DialogProvider>
      <NoteEditorPane {...(props as any)} />
    </DialogProvider>,
  );
  await waitFor(() => !!editorOf(view!.container), 4000, 'editor');
}
const ed = () => editorOf(view!.container);
/** The top-level blocks, without the empty paragraph the editor keeps after a final heading, list, quote or table. */
const blocks = () => {
  const c = ed().getJSON().content;
  const end = c.length > 1 && c.at(-1).type === 'paragraph' && !c.at(-1).content ? c.length - 1 : c.length;
  return c.slice(0, end).map((n: any) => (n.type === 'heading' ? `h${n.attrs.level}` : n.type));
};
const cursor = (pos: number) => act(async () => void ed().view.dispatch(ed().state.tr.setSelection(TextSelection.create(ed().state.doc, pos))));
/** The dropdown button by its group name ("Headings", or "Headings: Heading 2" when one is in use). */
const menuButton = (name: string) => [...view!.container.querySelectorAll('.toolbar .tb-menu-button')].find((b) => b.getAttribute('aria-label')!.split(':')[0] === name) as HTMLButtonElement;
const menu = () => document.querySelector('.tb-menu') as HTMLElement | null;
const rows = () => [...document.querySelectorAll('.tb-menu [role^="menuitem"]')] as HTMLButtonElement[];
const row = (label: string) => rows().find((r) => r.textContent === label)!;
const iconOf = (b: Element) => [...b.querySelector('svg.lucide:not(.lucide-chevron-down)')!.classList].find((c) => c.startsWith('lucide-') && c !== 'lucide-icon')!;
async function choose(menuName: string, label: string) {
  await click(menuButton(menuName));
  await waitFor(() => !!menu(), 2000, `${menuName} menu`);
  await click(row(label));
}
const key = (k: string, el: Element = document.activeElement!, init: KeyboardEventInit = {}) =>
  act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })));

describe('the four dropdowns', () => {
  it('each is an icon and a chevron with a name and tooltip, and lists its rows with icons, in order', async () => {
    await open([p(t('hello'))]);
    const expected = {
      Headings: { icon: 'lucide-letter-h', role: 'menuitemradio', rows: [['Normal text', 'lucide-pilcrow'], ['Heading 1', 'lucide-heading-1'], ['Heading 2', 'lucide-heading-2'], ['Heading 3', 'lucide-heading-3']] },
      Lists: { icon: 'lucide-list', role: 'menuitemcheckbox', rows: [['Bullet list', 'lucide-list'], ['Numbered list', 'lucide-list-ordered'], ['Task list', 'lucide-list-todo']] },
      Blocks: { icon: 'lucide-text-quote', role: 'menuitemcheckbox', rows: [['Quote', 'lucide-quote'], ['Code block', 'lucide-square-code']] },
      Insert: { icon: 'lucide-plus', role: 'menuitem', rows: [['Horizontal line', 'lucide-minus'], ['Table', 'lucide-table'], ['Image', 'lucide-image-plus']] },
    };
    for (const [name, e] of Object.entries(expected)) {
      const b = menuButton(name);
      expect(b.getAttribute('aria-label')).toBe(name);
      expect(b.getAttribute('title')).toBe(name);
      expect(b.getAttribute('aria-haspopup')).toBe('menu');
      expect(b.getAttribute('aria-expanded')).toBe('false');
      expect(b.classList.contains('active')).toBe(false);
      expect(iconOf(b)).toBe(e.icon);
      expect(b.querySelector('svg.lucide-chevron-down')).not.toBeNull();
      await click(b);
      expect(b.getAttribute('aria-expanded')).toBe('true');
      expect(menu()!.getAttribute('role')).toBe('menu');
      expect(menu()!.getAttribute('aria-label')).toBe(name);
      expect(b.getAttribute('aria-controls')).toBe(menu()!.id);
      expect(rows().map((r) => [r.textContent, iconOf(r)])).toEqual(e.rows);
      expect(rows().every((r) => r.getAttribute('role') === e.role)).toBe(true);
      if (e.role === 'menuitem') expect(rows().every((r) => !r.hasAttribute('aria-checked'))).toBe(true);
      await click(b); // closes
      expect(menu()).toBeNull();
    }
  });

  it('Headings: each level, toggled off by choosing it again, and Normal text; the button follows', async () => {
    await open([p(t('hello'))]);
    await cursor(2);
    await click(menuButton('Headings'));
    expect(rows().map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']); // a paragraph: Normal text
    await click(row('Heading 2'));
    expect(menu()).toBeNull();
    expect(blocks()).toEqual(['h2']);
    const b = menuButton('Headings');
    expect(b.getAttribute('aria-label')).toBe('Headings: Heading 2');
    expect(b.classList.contains('active')).toBe(true);
    expect(iconOf(b)).toBe('lucide-heading-2');
    await click(b);
    expect(rows().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
    await click(row('Heading 2')); // again: back to normal text, as the old button toggled
    expect(blocks()).toEqual(['paragraph']);
    expect(menuButton('Headings').classList.contains('active')).toBe(false);
    await choose('Headings', 'Heading 3');
    expect(blocks()).toEqual(['h3']);
    await choose('Headings', 'Heading 1');
    expect(blocks()).toEqual(['h1']);
    expect(iconOf(menuButton('Headings'))).toBe('lucide-heading-1');
    await choose('Headings', 'Normal text');
    expect(blocks()).toEqual(['paragraph']);
    expect(iconOf(menuButton('Headings'))).toBe('lucide-letter-h');
  });

  it('Lists: bullet, numbered and task lists, each toggled off again; the button shows the list in use', async () => {
    await open([p(t('hello'))]);
    await cursor(2);
    for (const [label, type, icon] of [
      ['Bullet list', 'bulletList', 'lucide-list'],
      ['Numbered list', 'orderedList', 'lucide-list-ordered'],
      ['Task list', 'taskList', 'lucide-list-todo'],
    ]) {
      await choose('Lists', label);
      expect(blocks()).toEqual([type]);
      const b = menuButton('Lists');
      expect(b.getAttribute('aria-label')).toBe(`Lists: ${label}`);
      expect(b.classList.contains('active')).toBe(true);
      expect(iconOf(b)).toBe(icon);
      await click(b);
      expect(rows().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent)).toEqual([label]);
      await click(row(label));
      expect(blocks()).toEqual(['paragraph']);
      expect(menuButton('Lists').classList.contains('active')).toBe(false);
    }
  });

  it('Blocks: quote and code block, each toggled off again; the button shows the block in use', async () => {
    await open([p(t('hello'))]);
    await cursor(2);
    await choose('Blocks', 'Quote');
    expect(blocks()).toEqual(['blockquote']);
    expect(iconOf(menuButton('Blocks'))).toBe('lucide-quote');
    expect(menuButton('Blocks').getAttribute('aria-label')).toBe('Blocks: Quote');
    await choose('Blocks', 'Quote');
    expect(blocks()).toEqual(['paragraph']);
    await choose('Blocks', 'Code block');
    expect(blocks()).toEqual(['codeBlock']);
    expect(iconOf(menuButton('Blocks'))).toBe('lucide-square-code');
    await choose('Blocks', 'Code block');
    expect(blocks()).toEqual(['paragraph']);
    expect(iconOf(menuButton('Blocks'))).toBe('lucide-text-quote');
  });

  it('Insert: a horizontal line, a table (unavailable inside one) and an image (the file picker); always a plus', async () => {
    await open([p(t('hello'))]);
    await cursor(6);
    await choose('Insert', 'Horizontal line');
    expect(blocks()).toContain('horizontalRule');
    expect(iconOf(menuButton('Insert'))).toBe('lucide-plus');
    await cursor(2);
    await choose('Insert', 'Table');
    expect(blocks()).toContain('table');
    expect(ed().isActive('table')).toBe(true);
    expect(iconOf(menuButton('Insert'))).toBe('lucide-plus');
    expect(menuButton('Insert').classList.contains('active')).toBe(false);
    await click(menuButton('Insert'));
    expect(row('Table').disabled).toBe(true);
    const tables = blocks().filter((x: string) => x === 'table').length;
    await click(row('Table'));
    expect(blocks().filter((x: string) => x === 'table').length).toBe(tables);
    expect(menu()).not.toBeNull(); // a disabled row does nothing, and the menu stays open
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      await click(row('Image'));
      expect(pick).toHaveBeenCalledTimes(1);
      expect((pick.mock.contexts[0] as HTMLInputElement).type).toBe('file');
    } finally {
      pick.mockRestore();
    }
  });

  it('the button icons follow the cursor through a document; nesting shows the innermost', async () => {
    await open([
      { type: 'heading', attrs: { level: 2 }, content: [t('Title')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('item')), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p(t('todo'))] }] }] }] },
      { type: 'blockquote', content: [p(t('said'))] },
      { type: 'codeBlock', attrs: { language: null }, content: [t('x = 1')] },
      p(t('plain')),
    ]);
    const at = (text: string) => {
      let found = -1;
      ed().state.doc.descendants((n: any, pos: number) => {
        if (found < 0 && n.isText && n.text === text) found = pos + 1;
      });
      return found;
    };
    const state = () => ['Headings', 'Lists', 'Blocks'].map((n) => `${iconOf(menuButton(n))}${menuButton(n).classList.contains('active') ? '*' : ''}`);
    await cursor(at('Title'));
    expect(state()).toEqual(['lucide-heading-2*', 'lucide-list', 'lucide-text-quote']);
    await cursor(at('item'));
    expect(state()).toEqual(['lucide-letter-h', 'lucide-list*', 'lucide-text-quote']);
    await cursor(at('todo'));
    expect(state()).toEqual(['lucide-letter-h', 'lucide-list-todo*', 'lucide-text-quote']);
    await click(menuButton('Lists'));
    expect(rows().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent)).toEqual(['Task list']);
    await click(menuButton('Lists'));
    await cursor(at('said'));
    expect(state()).toEqual(['lucide-letter-h', 'lucide-list', 'lucide-quote*']);
    await cursor(at('x = 1'));
    expect(state()).toEqual(['lucide-letter-h', 'lucide-list', 'lucide-square-code*']);
    await cursor(at('plain'));
    expect(state()).toEqual(['lucide-letter-h', 'lucide-list', 'lucide-text-quote']);
  });
});

describe('keyboard', () => {
  it('ArrowDown on a button opens it on the checked row; arrows wrap, Home/End, disabled rows skipped; Escape returns to the button; Tab closes', async () => {
    await open([{ type: 'heading', attrs: { level: 3 }, content: [t('Title')] }, p(t('x'))]);
    await cursor(2);
    const b = menuButton('Headings');
    await act(async () => b.focus());
    await key('ArrowDown', b);
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(row('Heading 3')); // the checked row
    await key('ArrowDown');
    expect(document.activeElement).toBe(row('Normal text')); // wraps
    await key('ArrowUp');
    expect(document.activeElement).toBe(row('Heading 3'));
    await key('Home');
    expect(document.activeElement).toBe(row('Normal text'));
    await key('End');
    expect(document.activeElement).toBe(row('Heading 3'));
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0]); // roving focus
    await key('Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(menuButton('Headings'));
    await key('ArrowDown', menuButton('Headings'));
    await key('Tab');
    expect(menu()).toBeNull();
    // Inside a table, Insert's disabled Table row is skipped.
    await act(async () => void ed().chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run());
    const ins = menuButton('Insert');
    await act(async () => ins.focus());
    await key('ArrowDown', ins);
    expect(document.activeElement).toBe(row('Horizontal line')); // nothing checked: the first row
    await key('ArrowDown');
    expect(document.activeElement).toBe(row('Image'));
    await key('ArrowDown');
    expect(document.activeElement).toBe(row('Horizontal line'));
    await key('Escape');
  });

  it('Enter and Space choose the focused row and cancel the key, so it never reaches the note', async () => {
    await open([p(t('hello world'))]);
    await cursor(3);
    const press = async (k: string) => {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      await act(async () => void document.activeElement!.dispatchEvent(ev));
      return ev.defaultPrevented;
    };
    await key('ArrowDown', menuButton('Headings'));
    await key('ArrowDown'); // Normal text → Heading 1
    expect(await press('Enter')).toBe(true);
    expect(menu()).toBeNull();
    expect(blocks()).toEqual(['h1']);
    expect(ed().state.doc.textContent).toBe('hello world'); // not split
    await key('ArrowDown', menuButton('Lists'));
    expect(await press(' ')).toBe(true);
    expect(blocks()).toEqual(['bulletList']);
    expect(ed().state.doc.textContent).toBe('hello world');
  });

  it('the old keyboard shortcuts still work and the buttons follow them', async () => {
    await open([p(t('hello'))]);
    await cursor(2);
    const pm = view!.container.querySelector('.ProseMirror')!;
    await key('2', pm, { ctrlKey: true, altKey: true });
    expect(blocks()).toEqual(['h2']);
    expect(iconOf(menuButton('Headings'))).toBe('lucide-heading-2');
    await key('0', pm, { ctrlKey: true, altKey: true });
    expect(blocks()).toEqual(['paragraph']);
    await key('8', pm, { ctrlKey: true, shiftKey: true });
    expect(blocks()).toEqual(['bulletList']);
    expect(iconOf(menuButton('Lists'))).toBe('lucide-list');
    expect(menuButton('Lists').classList.contains('active')).toBe(true);
    await key('8', pm, { ctrlKey: true, shiftKey: true }); // toggles the list off again
    expect(blocks()).toEqual(['paragraph']);
    await key('b', pm, { ctrlKey: true, shiftKey: true });
    expect(blocks()).toEqual(['blockquote']);
    expect(iconOf(menuButton('Blocks'))).toBe('lucide-quote');
  });
});

describe('disabled states, as before', () => {
  it('inside inline code the font, size and colour controls are disabled; marks, dropdowns, undo stay as they were', async () => {
    await open([p(t('a '), t('code', [{ type: 'code' }]))]);
    await cursor(5);
    const tb = view!.container.querySelector('.toolbar')!;
    const disabled = [...tb.querySelectorAll('button, input')].filter((e) => (e as HTMLButtonElement).disabled).map((e) => e.getAttribute('aria-label'));
    expect(disabled).toEqual(['Styles', 'Font: Inter', 'Decrease font size', 'Font size', 'Increase font size', 'Text colour', 'Highlight', 'Undo', 'Redo']);
    for (const n of ['Headings', 'Lists', 'Blocks', 'Insert']) expect(menuButton(n).disabled).toBe(false);
    expect(button(tb, 'Bold')!.disabled).toBe(false);
  });
});

describe('the toolbar bar (DEVIATIONS 47)', () => {
  it('the toolbar sits in its wrapper; in a table the table tools are a second bar under it', async () => {
    await open([p(t('hello'))]);
    const wrap = view!.container.querySelector('.editor-pane > .toolbar-wrap')!;
    expect([...wrap.children].map((e) => e.getAttribute('aria-label'))).toEqual(['Formatting']);
    await act(async () => void ed().chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run());
    expect([...wrap.children].map((e) => `${e.className}:${e.getAttribute('role')}:${e.getAttribute('aria-label')}`)).toEqual(['toolbar:toolbar:Formatting', 'toolbar table-tools:toolbar:Table']);
    expect(wrap.querySelector('.table-tools button[aria-label="Add row below"]')).toBeTruthy();
  });
});
